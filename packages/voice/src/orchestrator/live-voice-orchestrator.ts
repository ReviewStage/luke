import {
  LIVE_SESSION_PHASE,
  type LiveSessionPhase,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import { LIVE_CLOSE_REASON, LIVE_STATUS, type LiveStatus, liveExchangeActive } from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { Deferred, Effect, Exit, Fiber, FiberId, Runtime, type Scope } from "effect";
import type {
  LiveCaptionRow,
  LiveVoiceCall,
  LiveVoiceCallEvents,
  LiveVoiceSpeakers,
} from "./live-voice-call.js";
import { NoticeStrip } from "./notice-strip.js";

/**
 * What the orchestrator reads rather than owns: whether a voice stands at
 * all, whether the captions are wanted, whether the output is silent, and
 * whether the microphone is granted. Amended whole from the document each
 * time it moves.
 */
export interface LiveVoiceSurroundings {
  voiceAvailable: boolean | undefined;
  captionsEnabled: boolean;
  outputSilent: boolean;
  microphoneGranted: boolean;
}

/**
 * What a panel needs to draw the live conversation, reported whole on every
 * edge. Both speakers are carried beside the status, which names one of them
 * at a time: the status is what the media duck and the exchange count read,
 * and the two flags are what a full-duplex panel draws.
 */
export interface LiveVoiceView extends LiveVoiceSpeakers {
  voiceStatus: LiveStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  /** Whether a press is still waiting on the session it opened. */
  talkOpening: boolean;
  /** Luke's rows while he speaks, when the captions preference or a silent output asks for them. */
  lukeCaptions: readonly string[] | undefined;
  /** Both speakers' rows still being spoken, ahead of the record the host writes once each settles. */
  liveConversationEntries: readonly ConversationEntry[];
  /** Whether the developer is being heard and has not been transcribed yet. */
  spokenAskPending: boolean;
}

/** Who opened the exchange the count is about: a press, or Luke's own speech into a session opened for it. */
export interface LiveVoiceExchangeOpening {
  microphoneCall: boolean;
}

/** Everything the policy asks of the process that hosts it. */
export interface LiveVoiceBridge {
  reportView(view: LiveVoiceView, exchange: LiveVoiceExchangeOpening | undefined): void;
  /** Asks the system for the microphone, answering whether it is granted. */
  requestMicrophone(): Promise<boolean>;
  /** The neutral note said when the hosted service's ceiling refuses a session. */
  hostedUnavailableNote(): Promise<string | undefined>;
  /** Tells the host to stop Luke speaking, answering whether a session stood to tell; the stop key's ask alone, and only while he speaks. */
  stopSpeaking(): Promise<boolean>;
}

export interface LiveVoiceOrchestratorOptions {
  bridge: LiveVoiceBridge;
  createCall: (events: LiveVoiceCallEvents) => LiveVoiceCall;
  /** The runtime the session's lifecycle fiber is forked on; `Runtime.defaultRuntime` for a caller (a test today) that holds none of its own. */
  runtime?: Runtime.Runtime<never>;
}

/** Nobody heard on either side, which is what a call that is gone carries. */
const SILENT: LiveVoiceSpeakers = { listening: false, lukeSpeaking: false };

const MICROPHONE_REFUSED_NOTE =
  "The talk key needs the microphone. Allow it in System Settings, " +
  "under Privacy & Security, Microphone — or type to Luke instead.";

function sameView(left: LiveVoiceView, right: LiveVoiceView): boolean {
  return (
    left.voiceStatus === right.voiceStatus &&
    left.voiceError === right.voiceError &&
    left.voiceNotice === right.voiceNotice &&
    left.talkOpening === right.talkOpening &&
    left.lukeCaptions === right.lukeCaptions &&
    left.liveConversationEntries === right.liveConversationEntries &&
    left.spokenAskPending === right.spokenAskPending &&
    left.listening === right.listening &&
    left.lukeSpeaking === right.lukeSpeaking
  );
}

/**
 * The one voice session as the desktop drives it, following the live guide's
 * one-owner rule: the renderer owns the microphone switch and the hang-up,
 * the host owns every append and the close decision. The talk key is held to
 * talk: its press opens the session if none stands and unmutes it, its
 * release mutes, and the microphone is open exactly between the two; the
 * stop key mutes the same way. The host's `voiceLiveSession.changed` is
 * obeyed rather than reasoned about: wanted opens a session with no
 * microphone for whatever Luke has to say, closing hangs up, and a session
 * lost while the key is still held is listened to again on the session that
 * replaces it. No turn is committed, no reply is claimed, and no words are
 * written here: both speakers' lines are the host's, from the transcript its
 * sideband receives.
 *
 * The standing call's whole life is one fiber, forked on the runtime this
 * orchestrator was handed: it acquires the call by opening it, waits to be
 * told the call should end, and releases it by closing it, so a call is
 * closed exactly once whichever way its life ends — on its own status, on the
 * host's word, or on `stop`'s interruption. `LiveVoiceCall`'s four verbs
 * answer Effects, run on that same runtime, but `#ensureSession` and every
 * public verb above them still answers a Promise of its own.
 *
 * @deprecated `beginTalk`, `endTalk`, and `stopSpeaking` answer promises
 * because this orchestrator still holds its own runtime rather than a caller's
 * fiber. P7-07 (compose-speech) deletes the promise-facing shape once the host
 * takes the fiber directly.
 */
export class LiveVoiceOrchestrator {
  readonly #bridge: LiveVoiceBridge;
  readonly #createCall: (events: LiveVoiceCallEvents) => LiveVoiceCall;
  readonly #runtime: Runtime.Runtime<never>;
  readonly #strip = new NoticeStrip({ onChanged: () => this.#touch() });
  #call: LiveVoiceCall | undefined;
  #surroundings: LiveVoiceSurroundings = {
    voiceAvailable: undefined,
    captionsEnabled: false,
    outputSilent: false,
    microphoneGranted: false,
  };
  #status: LiveStatus = LIVE_STATUS.IDLE;
  #speakers: LiveVoiceSpeakers = SILENT;
  #rows: readonly LiveCaptionRow[] = [];
  #lukeCaptions: readonly string[] | undefined;
  #liveEntries: readonly ConversationEntry[] = [];
  #talkOpening = false;
  /** Whether the microphone was last heard live, kept across the call's own end so a lost session knows what it was carrying. */
  #lastListening = false;
  /** Whether the developer was being heard when the session was lost, so its replacement listens again. */
  #resumeListening = false;
  /** Whether the session standing was opened by a press rather than for Luke's own speech. */
  #openedByPress = false;
  /** The open still negotiating: a second ask reads its answer rather than building a second call. */
  #opening: Deferred.Deferred<LiveVoiceCall | undefined> | undefined;
  /** The standing call's whole life, in the scope it was acquired into; interrupting this is what `stop` releases it with. */
  #lifecycle: Fiber.RuntimeFiber<void> | undefined;
  /** Completed once the standing call should end, which is what lets its lifecycle fiber close the scope and release it. */
  #ending: Deferred.Deferred<void> | undefined;
  /**
   * Whether the talk key is down. A press's unmute follows the session it
   * opened only while this still stands, so a key let go of, or a stop
   * pressed, during the opening leaves the session muted rather than
   * unmuting one nobody wants heard.
   */
  #pressHeld = false;
  #reported: LiveVoiceView | undefined;
  /** The call whose exchange has been counted, so a session pausing between Luke's sentences is not a second exchange. */
  #countedCall: LiveVoiceCall | undefined;
  #counted = false;
  #queued = false;
  #stopped = false;

  constructor(options: LiveVoiceOrchestratorOptions) {
    this.#bridge = options.bridge;
    this.#createCall = options.createCall;
    this.#runtime = options.runtime ?? Runtime.defaultRuntime;
  }

  #run<A>(effect: Effect.Effect<A>): Promise<A> {
    return Runtime.runPromise(this.#runtime)(effect);
  }

  surround(surroundings: LiveVoiceSurroundings): void {
    const stoodAvailable = this.#surroundings.voiceAvailable;
    this.#surroundings = surroundings;
    if (surroundings.voiceAvailable === false && stoodAvailable !== false && this.#call) {
      this.#endCall();
    }
    this.#recomposeCaptions();
    this.#touch();
  }

  /**
   * The talk key going down. Against no session it opens one and unmutes it;
   * against a standing session it unmutes. It never mutes: the key coming up
   * does that, so a hold is heard for exactly as long as it lasts, and a
   * hold that ended while the system's microphone dialog stood, or while the
   * session was opening, unmutes nothing.
   */
  async beginTalk(): Promise<void> {
    if (this.#surroundings.voiceAvailable === false) {
      const unavailable = await this.#bridge.hostedUnavailableNote();
      if (unavailable) this.#strip.showNotice(unavailable);
      return;
    }
    this.#pressHeld = true;
    if (!this.#surroundings.microphoneGranted) {
      const granted = await this.#bridge.requestMicrophone();
      if (!granted) {
        this.#strip.showError(MICROPHONE_REFUSED_NOTE);
        return;
      }
      if (!this.#pressHeld) return;
    }
    const call = await this.#ensureSession({ byPress: true });
    // A key let go of during the opening leaves the session muted, and the
    // mute is still sent: the press's device rode the offer, and only the
    // release takes it back.
    if (call) await this.#run(this.#pressHeld ? call.unmute() : call.mute());
    // The press is answered once the session hears the developer; between the
    // offer and the unmute the session passes through muted, which is not the
    // exchange ending.
    this.#talkOpening = false;
    this.#touch();
  }

  /**
   * The talk key coming up: the microphone closes. A release while the
   * press's session is still opening leaves it to open muted, and one with
   * no press behind it does nothing.
   */
  async endTalk(): Promise<void> {
    if (!this.#pressHeld) return;
    this.#pressHeld = false;
    if (this.#opening) return;
    const call = this.#call;
    if (call?.standing) await this.#run(call.mute());
  }

  /**
   * The stop key, and the panel's Escape: the microphone closes, and the host
   * tells the model to stop first where Luke is actually speaking. The stop
   * goes first so a press mid-sentence reaches the model as soon as it can,
   * and the mute lands even where the host could not be reached. A press
   * against a call that is merely listening sends none: the instruction is
   * standing text in the session, so telling a silent model to stop steers
   * the answer it has not given yet. The talk key's release is `endTalk` and
   * never carries the stop either: under hold-to-talk it mutes while Luke is
   * routinely still answering. Pressed while a press's session is still
   * opening, it cancels that press's unmute, so the session opens muted.
   */
  async stopSpeaking(): Promise<boolean> {
    this.#pressHeld = false;
    // A session still being opened has no peer to mute yet; the press
    // remembers the key is no longer held and leaves the session muted.
    if (this.#opening) return true;
    const call = this.#call;
    if (!call?.standing) return false;
    if (call.status === LIVE_STATUS.SPEAKING) await this.#bridge.stopSpeaking();
    await this.#run(call.mute());
    return true;
  }

  /**
   * What the document held when this window came up. A wanted the host
   * announced before the window subscribed would otherwise be a briefing left
   * queued until the next drain, so the standing phase is obeyed once at
   * adoption; every later phase arrives as its own event.
   */
  adoptStanding(phase: LiveSessionPhase | undefined): void {
    if (phase === LIVE_SESSION_PHASE.WANTED) this.obeySessionChange({ phase });
  }

  /** The panel asking for the microphone from its own row. */
  async requestMicrophoneAccess(): Promise<void> {
    await this.#bridge.requestMicrophone();
  }

  /**
   * The host's word on the one session. Wanted is Luke with something to say
   * and no session to say it into, so one opens with no microphone; closing
   * is the host's decision to end it, so the peer hangs up; a close that lost
   * the developer mid-hold is remembered so the next session listens again,
   * for as long as the key is still down.
   */
  obeySessionChange(change: VoiceLiveSessionChanged): void {
    switch (change.phase) {
      case LIVE_SESSION_PHASE.WANTED:
        if (this.#surroundings.voiceAvailable === false) return;
        void this.#ensureSession({ byPress: false }).then(async (call) => {
          const resume = this.#resumeListening;
          this.#resumeListening = false;
          if (call && resume && this.#pressHeld) await this.#run(call.unmute());
        });
        return;
      case LIVE_SESSION_PHASE.CLOSING:
        if (this.#aboutThisCall(change)) this.#endCall();
        return;
      case LIVE_SESSION_PHASE.CLOSED: {
        // A call still standing that the word is not about is left alone; no
        // call at all is the peer having ended first, and the word still says
        // whether the developer was being heard when the session was lost.
        if (this.#call && !this.#aboutThisCall(change)) return;
        // The host's word ends the session whatever the peer still shows: the
        // call is let go of here so the wanted that may follow opens a new
        // one, and it finishes its own hang-up behind. Whether the developer
        // was being heard is read from the last status the call reported,
        // since its own end may have landed before this event did.
        this.#resumeListening =
          this.#lastListening &&
          (change.reason === LIVE_CLOSE_REASON.EXPIRED ||
            change.reason === LIVE_CLOSE_REASON.CONNECTION_LOST);
        this.#lastListening = false;
        if (this.#call) {
          this.#call = undefined;
          this.#status = LIVE_STATUS.IDLE;
          this.#speakers = SILENT;
          this.#rows = [];
          this.#openedByPress = false;
          this.#endCall();
          this.#recomposeCaptions();
          this.#touch();
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Whether the host's word names the session this call holds. The host
   * closes a session it still held before creating the next, and that close
   * names the old session: a call still waiting for its offer to be answered
   * holds no session yet, and one answered holds another, so neither is the
   * one the host means.
   */
  #aboutThisCall(change: VoiceLiveSessionChanged): boolean {
    const held = this.#call?.sessionId;
    return held !== undefined && (change.sessionId === undefined || change.sessionId === held);
  }

  /**
   * Interrupts the standing call's lifecycle fiber, which is what releases
   * it: `Effect.acquireRelease`'s own guarantee closes it exactly once,
   * whether the interruption lands mid-open or mid-standing.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    const fiber = this.#lifecycle;
    this.#lifecycle = undefined;
    this.#call = undefined;
    if (fiber) await this.#run(Fiber.interrupt(fiber));
  }

  /** Signals the standing call's lifecycle fiber to end, which releases it by closing it exactly once. */
  #endCall(): void {
    const ending = this.#ending;
    this.#ending = undefined;
    if (ending) Deferred.unsafeDone(ending, Exit.void);
  }

  /**
   * The session standing or coming up, or a new one opened now. One opening
   * at a time: a second ask while the first is still negotiating waits for
   * it rather than offering the host a second peer.
   */
  #ensureSession(input: { byPress: boolean }): Promise<LiveVoiceCall | undefined> {
    return this.#run(this.#ensureSessionEffect(input));
  }

  #ensureSessionEffect(input: { byPress: boolean }): Effect.Effect<LiveVoiceCall | undefined> {
    return Effect.suspend(() => {
      if (this.#call?.standing) return Effect.succeed(this.#call);
      const negotiating = this.#opening;
      if (negotiating) return Deferred.await(negotiating);
      const opened = Deferred.unsafeMake<LiveVoiceCall | undefined>(FiberId.none);
      this.#opening = opened;
      this.#openedByPress = input.byPress;
      this.#strip.clear();
      const call = this.#createCall({
        onStatus: (status, speakers) => this.#onStatus(call, status, speakers),
        onCaptions: (rows) => this.#onCaptions(call, rows),
        onError: (message) => this.#strip.showError(message),
      });
      this.#call = call;
      this.#talkOpening = input.byPress;
      this.#touch();
      this.#lifecycle = Runtime.runFork(this.#runtime)(
        Effect.scoped(this.#lifecycleEffect(call, input, opened)),
      );
      return Deferred.await(opened);
    });
  }

  /**
   * The call's whole life, in the scope it was acquired into: opening it is
   * the acquire, closing it the release, so a call that fails to open, ends
   * on its own, is told to end, or has this fiber interrupted is closed
   * exactly once either way. `opened` is settled on every exit, including an
   * interruption that lands before the open itself decided anything, so a
   * concurrent ask waiting on it is never left hanging on a call `stop`
   * dropped before it stood.
   */
  #lifecycleEffect(
    call: LiveVoiceCall,
    input: { byPress: boolean },
    opened: Deferred.Deferred<LiveVoiceCall | undefined>,
  ): Effect.Effect<void, never, Scope.Scope> {
    return Effect.gen(this, function* () {
      const standing = yield* Effect.acquireRelease(call.open({ byPress: input.byPress }), () =>
        call.close(),
      );
      this.#opening = undefined;
      if (!standing) {
        this.#talkOpening = false;
        if (this.#call === call) this.#call = undefined;
        const unavailable = yield* Effect.promise(() => this.#bridge.hostedUnavailableNote());
        if (unavailable) this.#strip.showNotice(unavailable);
        this.#touch();
        yield* Deferred.succeed(opened, undefined);
        return;
      }
      this.#touch();
      yield* Deferred.succeed(opened, call);
      const ending = Deferred.unsafeMake<void>(FiberId.none);
      this.#ending = ending;
      yield* Deferred.await(ending);
    }).pipe(Effect.onExit(() => Effect.asVoid(Deferred.succeed(opened, undefined))));
  }

  #onStatus(call: LiveVoiceCall, status: LiveStatus, speakers: LiveVoiceSpeakers): void {
    if (this.#call !== call) return;
    this.#status = status;
    this.#speakers = speakers;
    // Only a standing session's status says anything about the microphone:
    // the rest leave the last live reading where it was, which is what a
    // session lost mid-hold was carrying.
    if (
      status === LIVE_STATUS.LISTENING ||
      status === LIVE_STATUS.MUTED ||
      status === LIVE_STATUS.SPEAKING
    ) {
      this.#lastListening = speakers.listening;
    }
    if (status === LIVE_STATUS.IDLE || status === LIVE_STATUS.FAILED) {
      this.#call = undefined;
      this.#rows = [];
      this.#openedByPress = false;
      this.#endCall();
    }
    this.#recomposeCaptions();
    this.#touch();
  }

  #onCaptions(call: LiveVoiceCall, rows: readonly LiveCaptionRow[]): void {
    if (this.#call !== call) return;
    this.#rows = rows;
    this.#recomposeCaptions();
    this.#touch();
  }

  /**
   * The captions as the panel draws them: Luke's words under the housing
   * while he speaks and there is a reason to read them, and every row still
   * being spoken as a line the Conversation tab draws ahead of the record.
   */
  #recomposeCaptions(): void {
    const unsettled = this.#rows.filter((row) => !row.settled);
    const lukeRows = unsettled
      .filter((row) => row.entry.kind === CONVERSATION_ENTRY_KIND.REPLY)
      .map((row) => row.entry.words);
    const wanted =
      (this.#surroundings.captionsEnabled || this.#surroundings.outputSilent) &&
      this.#status === LIVE_STATUS.SPEAKING;
    const nextCaptions = wanted && lukeRows.length > 0 ? lukeRows : undefined;
    if (!sameWords(this.#lukeCaptions, nextCaptions)) this.#lukeCaptions = nextCaptions;
    const nextEntries = unsettled.map((row) => row.entry);
    if (!sameEntries(this.#liveEntries, nextEntries)) this.#liveEntries = nextEntries;
  }

  #compose(): LiveVoiceView {
    return {
      voiceStatus: this.#status,
      listening: this.#speakers.listening,
      lukeSpeaking: this.#speakers.lukeSpeaking,
      voiceError: this.#strip.error,
      voiceNotice: this.#strip.notice,
      talkOpening: this.#talkOpening,
      lukeCaptions: this.#lukeCaptions,
      liveConversationEntries: this.#liveEntries,
      spokenAskPending:
        this.#status === LIVE_STATUS.LISTENING &&
        !this.#liveEntries.some((entry) => entry.kind === CONVERSATION_ENTRY_KIND.ASK),
    };
  }

  /**
   * Two facts moving together are one report, folded until the microtask
   * drains; a view that did not move is not reported at all, since the report
   * becomes a version of the document this same window reads. The count of
   * exchanges rides the report on the opening edge alone.
   */
  #touch(): void {
    if (this.#stopped || this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (this.#stopped) return;
      const view = this.#compose();
      if (this.#reported !== undefined && sameView(this.#reported, view)) return;
      this.#reported = view;
      const active = liveExchangeActive(view);
      const rising = active && !this.#counted && this.#call !== this.#countedCall;
      this.#counted = active;
      if (rising) this.#countedCall = this.#call;
      this.#bridge.reportView(view, rising ? { microphoneCall: this.#openedByPress } : undefined);
    });
  }
}

function sameWords(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((word, index) => word === right[index]);
}

function sameEntries(left: readonly ConversationEntry[], right: readonly ConversationEntry[]) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other !== undefined && entry.kind === other.kind && entry.words === other.words;
  });
}
