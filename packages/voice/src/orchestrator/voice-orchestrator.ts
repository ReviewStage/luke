import { BRAIN_REQUEST_ORIGIN } from "@sidecar/brain/requests";
import type { BrainAskResult, BrainReplyOffer } from "@sidecar/brain/requests-wire";
import {
  ARRIVAL_SPEECH_KIND,
  type ArrivalSpeech,
  REALTIME_STATUS,
  type RealtimeStatus,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  voiceExchangeActive,
} from "@sidecar/realtime";
import type { SpeechOffer } from "@sidecar/realtime/speech";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import {
  announcementConversationEntry,
  type ConversationEntry,
  joinReplyMessages,
  replyConversationEntry,
  SESSION_STATUS,
  type Session,
} from "@sidecar/session";
import { TALK_KEY_RELEASE, talkKeyRelease, voiceHotkeyLabel } from "@sidecar/settings";
import { askBrain } from "./brain-ask.js";
import { ConversationThread } from "./conversation-thread.js";
import { NoticeStrip } from "./notice-strip.js";
import { ReplyDeliveryPlayer } from "./reply-delivery-player.js";
import { SpeechMouth } from "./speech-mouth.js";
import type { VoiceBridge } from "./voice-bridge.js";
import {
  type ConversationVoiceCall,
  REPLY_KIND,
  type ReplyKind,
  type SpeakOnlyVoiceCall,
} from "./voice-call.js";
import {
  activeVoiceStream,
  liveConversationEntries,
  liveSpeedApplies,
  lukeCaptionsToShow,
  spokenAskPreviewSurvives,
  talkKeyPress,
  talkOpeningHolds,
  VOICE_RESTART,
  voiceRestartAction,
} from "./voice-policy.js";
import { VoiceReadiness, type VoiceReadinessPart } from "./voice-readiness.js";
import {
  type VoiceExchangeOpening,
  type VoiceViewReport,
  VoiceViewReporter,
} from "./voice-view-reporter.js";

/**
 * What the orchestrator reads rather than owns: the settings that shape a
 * call, the roster the arrival beat is worded from, the talk key its
 * suggestion names, the output the captions answer, and the holds. Amended
 * whole from the document each time it moves.
 */
export interface VoiceSurroundings {
  /** Undefined until the host has answered; saying "off" before then would draw a dead key. */
  voiceAvailable?: boolean;
  voice?: RealtimeVoice;
  voiceSpeed?: RealtimeVoiceSpeed;
  captionsEnabled: boolean;
  /** Whether the Mac's output would swallow the speech, which is a reason to read it. */
  outputSilent: boolean;
  /** Whether macOS has already granted the microphone, so a press need not ask again. */
  microphoneGranted: boolean;
  /** Whether a meeting or the developer's own switch holds announcements. */
  announcementsHeld: boolean;
  /** The observed roster, read at the moment an arrival beat is spoken. */
  sessions: readonly Session[];
  /** The talk key as the system registered it, absent where it refused the chord. */
  talkKey?: string;
}

const NO_SURROUNDINGS: VoiceSurroundings = {
  captionsEnabled: false,
  outputSilent: false,
  microphoneGranted: false,
  announcementsHeld: false,
  sessions: [],
};

/** The conversation slice the document carries, as this window reads it. */
export interface VoiceConversationSlice {
  entries: readonly ConversationEntry[];
  cleared: boolean;
}

/** The two streams the surface alone can do anything with. */
export interface VoiceState<Stream> {
  /** What the level meter should listen to, which is whoever holds the turn. */
  meterStream: Stream | undefined;
  /** What Luke's own voice plays through. */
  remoteStream: Stream | undefined;
}

/** What the orchestrator supplies to a call of either kind; the surface adds the transport. */
export interface SpeakOnlyCallHooks<Stream> {
  onStatus(status: RealtimeStatus): void;
  onRemoteStream(stream: Stream | undefined): void;
  onError(message: string | undefined): void;
  onCaption(
    texts: readonly string[] | undefined,
    kind: ReplyKind | undefined,
    runId?: string,
  ): void;
  onReplyEnded(texts: readonly string[], kind: ReplyKind | undefined, runId?: string): void;
}

/** What the developer's own call adds: the device, and the one tool. */
export interface ConversationCallHooks<Stream> extends SpeakOnlyCallHooks<Stream> {
  onLocalStream(stream: Stream | undefined): void;
  askBrain(question: string, submissionId: string): Promise<BrainAskResult>;
  onSpokenAsk(transcript: string, itemId: string): void;
  onSpokenAskDelta(itemId: string, delta: string): void;
  onSpokenAskFailed(itemId: string): void;
  onSpokenAskClosed(): void;
  onSpokenAskCommitted(itemId: string): void;
  onSpokenAskDiscarded(): void;
}

/**
 * The words of the reply under way and whose they are, held as one value so
 * a live Conversation line can never file a caption under a different reply.
 * The run named is the brain run whose end the words voice, when they are
 * one — the reply the main process has already written into the thread.
 */
interface VoiceCaption {
  texts: readonly string[] | undefined;
  kind: ReplyKind | undefined;
  runId: string | undefined;
}

export interface VoiceOrchestratorDeps<Stream> {
  createConversationCall(hooks: ConversationCallHooks<Stream>): ConversationVoiceCall;
  createSpeakOnlyCall(hooks: SpeakOnlyCallHooks<Stream>): SpeakOnlyVoiceCall;
  bridge: VoiceBridge;
  /** The wall clock the thread stamps its lines with. */
  now?: () => number;
  /**
   * A monotonic reading, which is what a held key is measured against: how
   * long a press lasted must not answer to a clock the system can move.
   */
  elapsed?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
  newEventId?: () => string;
}

/**
 * The spoken conversation's policy, held apart from anything that draws or
 * captures: the two kinds of call and which of them stands, the talk key's
 * latch, the mouth that lets Luke speak into silence, the receiving end of a
 * reply delivery, and the thread the exchange leaves behind. It holds no
 * transport — the peer connection, the capture device, the meter, and the
 * audio element are the surface's, reached through the seams above — and it
 * draws nothing: what it decides leaves as one reported view and one pair of
 * streams.
 */
export class VoiceOrchestrator<Stream> {
  readonly #deps: VoiceOrchestratorDeps<Stream>;
  readonly #bridge: VoiceBridge;
  readonly #thread: ConversationThread;
  readonly #readiness: VoiceReadiness;
  /** The two lines the strip draws when there is no speech to draw, and their shared clock. */
  readonly #strip: NoticeStrip;
  /** What leaves for every panel to draw, and the rules about when. */
  readonly #reporter: VoiceViewReporter;
  readonly #listeners = new Set<(state: VoiceState<Stream>) => void>();

  #surroundings: VoiceSurroundings = NO_SURROUNDINGS;
  /**
   * The two kinds of call this window can hold, each built at most once and
   * only one of them ever standing: the developer's own, and the speak-only
   * one Luke opens to read a notice out. They are two types rather than one
   * call with a flag, so nothing on the announcer's path can reach a capture
   * device or a tool.
   */
  #conversationCall: ConversationVoiceCall | undefined;
  #speakOnlyCall: SpeakOnlyVoiceCall | undefined;
  #mouth: SpeechMouth | undefined;
  #replyPlayer: ReplyDeliveryPlayer | undefined;

  #status: RealtimeStatus = REALTIME_STATUS.IDLE;
  /**
   * A pressed talk key still waiting for the call it asked to open. The meter
   * is drawn from this rather than from the connection, because the press is
   * the moment the developer needs answering: the handshake behind it takes
   * seconds, and a key that visibly does nothing for that long reads as a key
   * that did nothing.
   */
  #talkOpening = false;
  #localStream: Stream | undefined;
  #remoteStream: Stream | undefined;
  #caption: VoiceCaption = { texts: undefined, kind: undefined, runId: undefined };

  /** When the talk key went down, which is what tells a hold from a tap. */
  #talkPressedAt: number | undefined;
  /** Whether a tap has left a turn open for a later press to end. */
  #talkLatched = false;
  /**
   * Whether the exchange about to open was opened by the composer, for the
   * count alone: set once the words are away, which is after the call has
   * already reached the edge the count is taken on, and read once there.
   */
  #typedExchange = false;

  /** The receiver epoch the document gave this load, which every grant names. */
  #epoch: number | undefined;
  /** Rises whenever the brain's generation ends under this window, so a grant held across it is void. */
  #replyWithdrawals = 0;
  /** The slice the adoption placed, which the merge below must not run over. */
  #adopted: VoiceConversationSlice | undefined;

  #heardVoice: RealtimeVoice | undefined;
  #heardSpeed: RealtimeVoiceSpeed | undefined;
  #restartDue = false;

  #state: VoiceState<Stream> = { meterStream: undefined, remoteStream: undefined };
  #live: readonly ConversationEntry[] = [];
  #liveFrom: { previews: ReadonlyMap<string, string>; caption: VoiceCaption } | undefined;

  constructor(deps: VoiceOrchestratorDeps<Stream>) {
    this.#deps = deps;
    this.#bridge = deps.bridge;
    this.#readiness = new VoiceReadiness((epoch) => deps.bridge.reportReady(epoch));
    this.#strip = new NoticeStrip({
      onChanged: () => this.#report(),
      schedule: deps.schedule,
      cancel: deps.cancel,
    });
    this.#reporter = new VoiceViewReporter({
      compose: () => this.#view(),
      opening: () => this.#opening(),
      report: (view, exchange) => deps.bridge.reportView(view, exchange),
    });
    this.#thread = new ConversationThread({
      append: (entries) => deps.bridge.appendConversation(entries),
      onChanged: () => this.#report(),
      now: deps.now,
      schedule: deps.schedule,
      cancel: deps.cancel,
      newEventId: deps.newEventId,
    });
  }

  // — what the surface reads —

  subscribe(listener: (state: VoiceState<Stream>) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  snapshot(): VoiceState<Stream> {
    return this.#state;
  }

  // — what the surface tells it —

  /**
   * The document adopted once: the stored thread placed, the receiver epoch
   * this load was given, and the context the first turn waits on.
   */
  applyBootstrap(bootstrap: { conversation: VoiceConversationSlice; epoch?: number }): void {
    if (this.#adopted !== undefined) return;
    this.#adopted = bootstrap.conversation;
    this.#thread.seed(bootstrap.conversation.entries);
    this.#epoch = bootstrap.epoch;
    this.#readiness.bootstrapped(bootstrap.epoch);
  }

  /**
   * The main process's own lines in the thread — the ask a carried action was —
   * reaching this window as they reach every panel. A Clear travels on its own
   * command instead, so a slice that says cleared has nothing left to do, and
   * the slice the adoption already placed is not merged a second time.
   */
  observeConversation(slice: VoiceConversationSlice): void {
    // Before the adoption there is nothing to merge into: the thread it is
    // about to place is the same one this slice carries.
    if (this.#adopted === undefined || slice === this.#adopted || slice.cleared) return;
    this.#thread.merge(slice.entries);
  }

  /** Everything read rather than owned, amended whole whenever the document moves. */
  surround(next: VoiceSurroundings): void {
    const previous = this.#surroundings;
    this.#surroundings = next;
    if (previous.voiceAvailable !== next.voiceAvailable) this.#voiceAvailabilityChanged();
    if (next.voiceSpeed !== undefined) {
      const heard = this.#heardSpeed;
      this.#heardSpeed = next.voiceSpeed;
      if (liveSpeedApplies(heard, next.voiceSpeed)) this.#liveCall()?.applySpeed(next.voiceSpeed);
    }
    if (previous.voice !== next.voice) this.#considerRestart();
    if (previous.announcementsHeld !== next.announcementsHeld) {
      if (next.announcementsHeld) this.#ensureMouth().setHeld(true);
      else this.#mouth?.setHeld(false);
    }
    // The captions preference and the output's silence are read straight into
    // the view rather than acted on.
    this.#report();
  }

  installed(part: VoiceReadinessPart): void {
    this.#readiness.installed(part);
  }

  uninstalled(part: VoiceReadinessPart): void {
    this.#readiness.uninstalled(part);
  }

  /**
   * The talk key going down. Every press the system lets capture goes to the
   * call, including the one that has no call to press against yet: the
   * microphone opens for the press, so one that beats the call is remembered
   * and applied when it comes up.
   */
  async beginTalk(): Promise<void> {
    this.#talkPressedAt = this.#elapsed();
    // An ask whose send never landed leaves its mark behind; the key is the
    // other way in, so this press is what clears it.
    this.#typedExchange = false;
    // A latched turn is already open. This press is someone saying they are
    // done, which is the release's to answer.
    if (this.#talkLatched) return;
    // Luke's own call goes now rather than when the developer's opens: the
    // press is what stops him talking, whatever the handshake ahead of it.
    this.#standDownSpeakOnlyCall();
    const call = this.#ensureConversationCall();
    // The press is what opens a capture device, and the call under it may
    // have been opened by a typed ask, which asked the system for nothing.
    // So a press against anything but a granted microphone asks before the
    // turn opens: refused, the press is dropped here — before its device
    // request could fail a standing call that was carrying the typed
    // conversation fine.
    if (!this.#surroundings.microphoneGranted) {
      const pressedAt = this.#talkPressedAt;
      const granted = await this.#bridge.requestMicrophone();
      if (!granted) {
        // Said where the device failure used to land it: the caption strip.
        this.#strip.showError(
          "The talk key needs the microphone. Allow it in System Settings, " +
            "under Privacy & Security, Microphone — or type to Luke instead.",
        );
        return;
      }
      // The system's prompt can outlive the press that raised it. A key
      // released — or pressed again — while it stood has no turn left to
      // open here: opening one would put a live microphone under a key that
      // is already up.
      if (this.#talkPressedAt !== pressedAt) return;
    }
    // The interruption can synchronously hand over the reply the developer
    // just cut off. Let that older line land before marking the new turn, so
    // its delayed transcript is inserted after everything that preceded it.
    call.beginTurn();
    this.#thread.openTurn();
    const press = talkKeyPress({ latched: false, microphoneCall: call.microphoneCall });
    // A press against no call — or against Luke's own speak-only call, which
    // has no microphone to offer — has seconds of handshake ahead of it, and
    // the meter has to answer the press, not the handshake.
    if (press.openCall) this.#setTalkOpening(true);
    // The developer's call is up or already coming; the press waits its turn.
    if (!press.openCall) return;
    await this.#startMicrophone();
    // A hosted refusal would otherwise be answered by nothing at all. Keep
    // the emergency ceiling private and surface only temporary unavailability.
    if (call.status === REALTIME_STATUS.UNAVAILABLE) {
      const unavailable = await this.#bridge.hostedUnavailableNote();
      if (unavailable) this.#strip.showNotice(unavailable);
    }
  }

  /**
   * The talk key coming up. How long it was held is the whole of the decision:
   * held, the turn was as long as the key was down and is sent; tapped, it
   * stays open for the question too long to hold through, and the next release
   * sends it.
   */
  endTalk(): void {
    const pressedAt = this.#talkPressedAt;
    this.#talkPressedAt = undefined;
    // A release with nothing before it is not this key's to answer — a turn
    // ended by Escape leaves the key still down.
    if (pressedAt === undefined) return;
    const release = talkKeyRelease({
      heldMs: this.#elapsed() - pressedAt,
      latched: this.#talkLatched,
    });
    if (release === TALK_KEY_RELEASE.LATCH) {
      // A latch keeps a turn open past the release, so it needs a turn to
      // keep: pending counts — the tap-to-open flow latches while its call is
      // still on the way — but a press that opened none, because the
      // permission prompt or a failed device swallowed it, must not latch, or
      // the next press would read as the end of a turn nobody is holding.
      if (
        this.#conversationCall?.turnPending === true ||
        this.#status === REALTIME_STATUS.LISTENING
      ) {
        this.#talkLatched = true;
      }
      return;
    }
    this.#talkLatched = false;
    this.#conversationCall?.endTurn(true);
    // A held press let go of before the call opened is no longer always
    // dropped: its words were captured beside the handshake, and a press that
    // said something is still owed its turn. One that said nothing leaves
    // with its meter, as it always did.
    const call = this.#conversationCall;
    if (call && !call.isConnected && !call.turnPending) this.#setTalkOpening(false);
  }

  /** Escape, or the panel's own discard: the turn being held is dropped unsaid. */
  discardListening(): void {
    this.#talkLatched = false;
    this.#talkPressedAt = undefined;
    this.#conversationCall?.stopListening(false);
  }

  /** The stop key, or the panel's: whatever is being said is cut where it stands. */
  stopSpeaking(): void {
    this.#liveCall()?.stopSpeaking();
  }

  /**
   * Asks the system for access and nothing else. The capture device itself is
   * the talk key's own action: it opens with a press and closes with the turn,
   * and the panel's row must not be a second way to it.
   */
  async requestMicrophoneAccess(): Promise<void> {
    await this.#bridge.requestMicrophone();
  }

  /**
   * The Clear a panel pressed, already carried out by the main process,
   * arriving here to retire this window's in-flight turns the way the press
   * would have. The talk key's latch goes with them: a turn the press just
   * retired is not one the next press ends.
   */
  clearConversation(): void {
    this.#thread.clear();
    this.#talkLatched = false;
    this.#talkPressedAt = undefined;
    // A reply offered or granted before the press belongs to the cleared
    // thread: not spoken, not shown, not acknowledged.
    this.#replyWithdrawals += 1;
    this.#replyPlayer?.withdraw();
  }

  /** One proactive turn the arbiter has offered: a briefing, or an onboarding beat. */
  offerSpeech(offer: SpeechOffer): void {
    this.#ensureMouth().offer(offer);
  }

  /** The arbiter taking an offer back before it is spoken. */
  withdrawSpeech(id: string): void {
    this.#mouth?.withdraw(id);
  }

  /** The main process offering an ended run's reply for this window to claim. */
  offerReply(offer: BrainReplyOffer): void {
    this.#ensureReplyPlayer().offer(offer);
  }

  /** The brain's generation ended, so whatever it offered or granted is void here too. */
  withdrawReplies(): void {
    this.#replyWithdrawals += 1;
    this.#replyPlayer?.withdraw();
  }

  /**
   * The meter's edge: whether whoever holds the turn is audible. Luke's reply
   * is over when it stops being audible, not when the model stops producing
   * it, and the call decides that a pause between two sentences is not an end.
   */
  reportRemoteAudioLevel(active: boolean): void {
    this.#liveCall()?.reportRemoteAudioLevel(active);
  }

  /** Puts away whichever calls this window still holds, and lets go of every clock. */
  async stop(): Promise<void> {
    this.#reporter.stop();
    this.#strip.stop();
    this.#thread.stop();
    await this.#closeCalls();
  }

  // — the calls —

  #ensureConversationCall(): ConversationVoiceCall {
    this.#conversationCall ??= this.#deps.createConversationCall({
      onStatus: (status) => this.#setStatus(status),
      onRemoteStream: (stream) => this.#setRemoteStream(stream),
      onLocalStream: (stream) => this.#setLocalStream(stream),
      onError: (message) => this.#strip.showError(message),
      onCaption: (texts, kind, runId) => this.#setCaption(texts, kind, runId),
      onReplyEnded: (texts, kind, runId) => this.#replyEnded(texts, kind, runId),
      askBrain: (question, submissionId) =>
        askBrain(
          {
            bridge: this.#bridge,
            thread: this.#thread,
            epoch: () => this.#epoch ?? 0,
            withdrawals: () => this.#replyWithdrawals,
          },
          question,
          submissionId,
        ),
      onSpokenAsk: (transcript, itemId) => this.#thread.rememberSpokenAsk(transcript, itemId),
      onSpokenAskDelta: (itemId, delta) => this.#thread.previewSpokenAsk(itemId, delta),
      onSpokenAskFailed: (itemId) => this.#thread.failTurn(itemId),
      onSpokenAskClosed: () => this.#thread.closeTurn(),
      onSpokenAskCommitted: (itemId) => this.#thread.commitTurn(itemId),
      onSpokenAskDiscarded: () => this.#thread.discardTurn(),
    });
    return this.#conversationCall;
  }

  /**
   * The call Luke opens for himself. A stood-down call cannot be recalled
   * mid-handshake: a mint already out lands when it lands, and the abandon
   * that follows tears the attempt down and reports it. Reported to the
   * window, that teardown would clear the remote stream the developer's call
   * had already put there, and a late failure of Luke's own call would be
   * drawn as theirs. So the speak-only call is heard only while no
   * conversation call has taken over, which is exactly when standing it down
   * happens.
   */
  #ensureSpeakOnlyCall(): SpeakOnlyVoiceCall {
    const heard = (): boolean =>
      !this.#conversationCall?.isConnected && !this.#conversationCall?.isConnecting;
    this.#speakOnlyCall ??= this.#deps.createSpeakOnlyCall({
      onStatus: (status) => {
        if (heard()) this.#setStatus(status);
      },
      onRemoteStream: (stream) => {
        if (heard()) this.#setRemoteStream(stream);
      },
      onError: (message) => {
        if (heard()) this.#strip.showError(message);
      },
      onCaption: (texts, kind, runId) => this.#setCaption(texts, kind, runId),
      onReplyEnded: (texts, kind, runId) => this.#replyEnded(texts, kind, runId),
    });
    return this.#speakOnlyCall;
  }

  /**
   * The call now standing, whichever kind opened it — what a stop, a pace
   * change, or the meter's report is for.
   */
  #liveCall(): SpeakOnlyVoiceCall | undefined {
    const conversation = this.#conversationCall;
    if (conversation?.isConnected || conversation?.isConnecting) return conversation;
    const speakOnly = this.#speakOnlyCall;
    if (speakOnly?.isConnected || speakOnly?.isConnecting) return speakOnly;
    return undefined;
  }

  /**
   * Stands Luke's own call down for the developer's, which is what the
   * takeover is now that they are two calls: whatever it was reading out is
   * cut where the developer's press or ask landed, and the call it was riding
   * is put away rather than left open beside the one about to answer them.
   */
  #standDownSpeakOnlyCall(): void {
    const speakOnly = this.#speakOnlyCall;
    if (!speakOnly?.isConnected && !speakOnly?.isConnecting) return;
    speakOnly.stopSpeaking();
    void speakOnly.close();
  }

  async #closeCalls(): Promise<void> {
    await Promise.all([this.#conversationCall?.close(), this.#speakOnlyCall?.close()]);
  }

  /**
   * Opens the developer's call. Nothing is fed to it: the roster, the history,
   * and the guide are the brain's, in the main process, and the voice reaches
   * them through its one tool. Nothing is asked of the system on the way
   * either: connecting declares a bare transceiver, no capture device opens,
   * and the microphone permission has no part in it.
   */
  async #startConversation(): Promise<boolean> {
    await this.#thread.waitForContext();
    this.#strip.clear();
    this.#standDownSpeakOnlyCall();
    return this.#ensureConversationCall().connect();
  }

  /**
   * The press's way in: asks the system about the microphone, then opens the
   * call. The gate belongs here and not on the call itself, because the press
   * is what opens a capture device; a call opened for a typed ask never asks.
   */
  async #startMicrophone(): Promise<void> {
    this.#strip.showError(undefined);
    const call = this.#ensureConversationCall();
    if (!(await this.#bridge.requestMicrophone())) {
      // The press that asked for this is still waiting for a call that is now
      // not coming. The status never changes on this path, so the meter the
      // press put up is taken down here rather than by a status settling.
      call.dropPendingTurn();
      this.#setTalkOpening(false);
      return;
    }
    await this.#startConversation();
  }

  // — the mouth —

  /**
   * Words the arrival beat from what is true at the moment it is spoken, not
   * at the moment it was queued: the trigger lands seconds after sign-in,
   * while the first observation pass and the call's own handshake are still
   * running, and a beat worded then would name no session on a machine full
   * of them. The title is read from the same observed roster every row draws,
   * and the spoken try is only suggested while voice could actually take it.
   */
  #wordedArrival(speech: ArrivalSpeech): ArrivalSpeech {
    const held = this.#surroundings;
    const working = held.sessions.find(
      (session) => session.status === SESSION_STATUS.WORKING && session.realtimeVoice !== true,
    );
    // The chord read as the document holds it: a key deleted or refused its
    // chord is absent there, so no beat can name one that no longer answers,
    // and a beat is only offered the key while voice could actually take it.
    const talkKey = held.voiceAvailable === true ? held.talkKey : undefined;
    return {
      ...speech,
      ...(working ? { sessionTitle: working.title } : undefined),
      ...(talkKey === undefined ? undefined : { talkKeyLabel: voiceHotkeyLabel(talkKey) }),
    };
  }

  /**
   * The mouth that lets Luke speak into silence: it takes the one turn the
   * arbiter offers and, when no conversation is open, opens a speak-only call
   * of Luke's own to say it through, then closes it. The call it drives is
   * wrapped once, so an arrival beat is worded at the moment of speaking;
   * every other member forwards untouched.
   */
  #ensureMouth(): SpeechMouth {
    this.#mouth ??= new SpeechMouth({
      settle: (id, outcome) => this.#bridge.settleSpeech(id, outcome),
      session: () => {
        // The developer's call while one stands — the mouth rides it rather
        // than opening a second — and Luke's own speak-only call otherwise.
        const developers = this.#conversationCall;
        const call: SpeakOnlyVoiceCall =
          developers?.isConnected || developers?.isConnecting
            ? developers
            : this.#ensureSpeakOnlyCall();
        return {
          get isConnected() {
            return call.isConnected;
          },
          get isConnecting() {
            return call.isConnecting;
          },
          get status() {
            return call.status;
          },
          get microphoneCall() {
            return call.microphoneCall;
          },
          connect: () => call.connect(),
          speak: (item) => {
            const arrival = item.kind === ARRIVAL_SPEECH_KIND;
            const spoke = call.speak(arrival ? this.#wordedArrival(item) : item);
            // The generation the announcement was decided in, so a Clear
            // while it is being read out keeps its words out of the thread
            // that replaced it. An arrival beat is recorded as plain words
            // and claims no announcement generation of its own.
            if (spoke && !arrival) this.#thread.markAnnouncement();
            return spoke;
          },
          stopSpeaking: () => call.stopSpeaking(),
          close: () => call.close(),
        };
      },
    });
    return this.#mouth;
  }

  // — reply deliveries —

  /**
   * The receiving end of reply deliveries: the one offer the main process has
   * out to this window, claimed at a quiet moment and spoken on the
   * developer's own call — opened for them if none stands — or put on the
   * strip where the voice cannot say it, and acknowledged when its reply ends
   * so the next may be offered. Nothing is recorded here: the thread already
   * holds the words.
   */
  #ensureReplyPlayer(): ReplyDeliveryPlayer {
    this.#replyPlayer ??= new ReplyDeliveryPlayer({
      session: () => this.#ensureConversationCall(),
      connect: () => this.#startConversation(),
      claim: (offer) => this.#bridge.claimBrainReply(offer.runId, offer.deliveryId, offer.epoch),
      acknowledge: (offer) =>
        this.#bridge.ackBrainReply(offer.runId, offer.deliveryId, offer.epoch),
      showNotice: (words) => this.#strip.showNotice(words),
      // Only a typed ask's reply is the composer's exchange, and counts as
      // one. A spoken ask answered late is the spoken exchange it always was.
      onSpeaking: (origin) => {
        this.#strip.showNotice(undefined);
        if (origin !== BRAIN_REQUEST_ORIGIN.TYPED) return;
        this.#typedExchange = true;
        this.#report();
      },
      conversationGeneration: () => this.#thread.generation,
    });
    return this.#replyPlayer;
  }

  #replyEnded(
    texts: readonly string[],
    kind: ReplyKind | undefined,
    runId: string | undefined,
  ): void {
    if (kind === REPLY_KIND.BRIEFING) {
      const generation = this.#thread.takeAnnouncementGeneration();
      this.#thread.remember(announcementConversationEntry(joinReplyMessages(texts)), generation);
      return;
    }
    const generation = this.#thread.takeReplyGeneration();
    // A reply voicing a brain run's end is already in the thread, written by
    // the main process from the record; the voice's rendering of it is not a
    // second line. The reply names its own run, so a reply cut off by the next
    // one cannot hand its attribution to it, and its ending is what lets the
    // next delivered reply be offered.
    if (runId !== undefined) {
      this.#replyPlayer?.onReplyEnded(runId);
      return;
    }
    this.#thread.remember(replyConversationEntry(joinReplyMessages(texts)), generation);
  }

  // — the edges —

  #setStatus(status: RealtimeStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    // The player paces itself by the status: a quiet moment is when an offer
    // in hand may be claimed, and a call ending settles the grant on it.
    this.#replyPlayer?.onStatus(status);
    this.#considerRestart();
    // The call gone takes its half-transcribed turns with it: no completed
    // transcript can arrive to settle a preview, so none may keep streaming.
    if (!spokenAskPreviewSurvives(status)) this.#thread.clearPreviews();
    // Any settled status ends the wait the press started, however it ended,
    // unless the press is still owed a turn — a takeover passes through
    // Luke's own call settling on its way to the developer's.
    if (!talkOpeningHolds({ status, turnPending: this.#conversationCall?.turnPending === true })) {
      this.#talkOpening = false;
    }
    // An exchange going live outranks the notice clock: the conversation has
    // moved on, and a fault the turn hid must not come back once the words
    // finish.
    if (voiceExchangeActive(status)) this.#strip.clear();
    // The mouth paces itself by the status too: READY is when the offer in
    // hand can speak and when an empty hand starts the walk toward closing
    // the call Luke opened for himself.
    this.#ensureMouth().onStatus(status);
    this.#report();
  }

  /** Voice arriving and voice going away, which is not only true of a launch. */
  #voiceAvailabilityChanged(): void {
    const available = this.#surroundings.voiceAvailable;
    // Not yet known. Saying "off" before the answer arrives would draw the
    // unavailable state over a working key for the first frames of every
    // launch.
    if (available === undefined) return;
    if (!available) {
      // The call is gone, so a tap-to-keep-open turn cannot still be open.
      // Leaving the latch set would make the next press look like the end of
      // that turn and do nothing.
      this.#talkLatched = false;
      this.#talkPressedAt = undefined;
      void this.#closeCalls().then(() => {
        // The close is async. A key deleted and reconnected while it was in
        // flight has already rebuilt a minter; forcing unavailable then would
        // leave the talk key looking dead over a live credential.
        if (this.#surroundings.voiceAvailable === false) {
          this.#setStatus(REALTIME_STATUS.UNAVAILABLE);
        }
      });
      return;
    }
    // Only the status voice being off put there is lifted. Anything else — a
    // failure, a call already open — is the call's own to report.
    if (this.#status === REALTIME_STATUS.UNAVAILABLE) this.#setStatus(REALTIME_STATUS.IDLE);
  }

  #considerRestart(): void {
    const live = this.#liveCall();
    const decided = voiceRestartAction({
      previous: this.#heardVoice,
      next: this.#surroundings.voice,
      live: live?.isConnected === true || live?.isConnecting === true,
      due: this.#restartDue,
      status: this.#status,
    });
    if (this.#surroundings.voice !== undefined) this.#heardVoice = this.#surroundings.voice;
    this.#restartDue = decided.due;
    if (decided.action !== VOICE_RESTART.RESTART) return;
    // Reconnecting is the call's act, not a press: the device the old call
    // held went with its close, and the next press asks for its own.
    void (async () => {
      await this.#closeCalls();
      await this.#startConversation();
    })();
  }

  #setCaption(
    texts: readonly string[] | undefined,
    kind: ReplyKind | undefined,
    runId: string | undefined,
  ): void {
    this.#caption = { texts, kind, runId };
    this.#report();
  }

  #setLocalStream(stream: Stream | undefined): void {
    this.#localStream = stream;
    this.#report();
  }

  #setRemoteStream(stream: Stream | undefined): void {
    this.#remoteStream = stream;
    this.#report();
  }

  #setTalkOpening(opening: boolean): void {
    this.#talkOpening = opening;
    this.#report();
  }

  // — what leaves —

  /**
   * Something moved. Which stream the surface should be playing and metering
   * is settled here, because a listener is what re-reads it; whether the view
   * moved with it is the reporter's to settle.
   */
  #report(): void {
    this.#publishStreams();
    this.#reporter.touch();
  }

  /**
   * The meter listens to whoever holds the turn, and the audio element plays
   * whatever the call put there. The snapshot is replaced only when one of
   * the two changed, so a reader subscribed to it re-renders for nothing.
   */
  #publishStreams(): void {
    const meterStream = activeVoiceStream({
      status: this.#status,
      local: this.#localStream,
      remote: this.#remoteStream,
    });
    if (
      meterStream === this.#state.meterStream &&
      this.#remoteStream === this.#state.remoteStream
    ) {
      return;
    }
    this.#state = { meterStream, remoteStream: this.#remoteStream };
    for (const listener of [...this.#listeners]) listener(this.#state);
  }

  #view(): VoiceViewReport {
    return {
      voiceStatus: this.#status,
      voiceError: this.#strip.error,
      voiceNotice: this.#strip.notice,
      talkOpening: this.#talkOpening,
      lukeCaptions: lukeCaptionsToShow({
        captionsEnabled: this.#surroundings.captionsEnabled,
        outputSilent: this.#surroundings.outputSilent,
        status: this.#status,
        captions: this.#caption.texts,
      }),
      liveConversationEntries: this.#liveEntries(),
      // Gated by the same survival rule as the previews: a call gone can
      // deliver no words, so nothing is awaited from it.
      spokenAskPending: spokenAskPreviewSurvives(this.#status) && this.#thread.awaitingSpokenWords,
    };
  }

  #opening(): VoiceExchangeOpening {
    const opening = {
      microphoneCall: this.#conversationCall?.microphoneCall === true,
      typedAsk: this.#typedExchange,
    };
    this.#typedExchange = false;
    return opening;
  }

  /**
   * The live lines are derived, not queued: they arrive with the captions and
   * die with them, so Conversation can never show words still arriving for a reply
   * or a turn that has already settled or left. Rebuilt only when one of the
   * two things it is derived from has been replaced, so an unmoved view
   * compares equal to the one last reported.
   */
  #liveEntries(): readonly ConversationEntry[] {
    const previews = this.#thread.previews;
    if (this.#liveFrom?.previews !== previews || this.#liveFrom.caption !== this.#caption) {
      this.#live = liveConversationEntries({
        spokenAskPreviews: previews,
        captions: this.#caption.texts,
        kind: this.#caption.kind,
        runId: this.#caption.runId,
      });
      this.#liveFrom = { previews, caption: this.#caption };
    }
    return this.#live;
  }

  #elapsed(): number {
    return this.#deps.elapsed?.() ?? performance.now();
  }
}
