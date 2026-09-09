import {
  BRAIN_ASK_PENDING_STATUS,
  type BrainAppActRequest,
  type BrainAskResult,
} from "@sidecar/brain/requests-wire";
import {
  ASK_BRAIN_TOOL,
  BRIEFING_SPEECH_KIND,
  briefingSpeechEvents,
  clearInputAudioEvents,
  functionCallFollowUpEvents,
  type ParsedRealtimeFunctionCall,
  type ParsedRealtimeServerEvent,
  pushToTalkCommitEvents,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeStatus,
  realtimeSessionConfig,
} from "@sidecar/realtime";
import { maximumTypedAskLength } from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { voiceExchangeActive } from "#shared/messages/voice-view";
import type { BuiltRealtimeSessionConfig, SdkToolCallDetails } from "./agents-realtime-transport";
import { REPLY_KIND } from "./captions";
import { MICROPHONE_PROCESSING } from "./microphone-choice";
import type { PressCaptureFactory } from "./press-audio-capture";
import { type MicrophoneSender, PressTurnCapture } from "./press-turn-capture";
import type { TeardownStep } from "./realtime-call";
import {
  BRAIN_ASK_SETTLE_TIMEOUT_MS,
  type ResponseDoneEvent,
  SpeakOnlyCall,
  type SpeakOnlyCallOptions,
} from "./speak-only-call";
import { ToolFollowUp } from "./tool-follow-up";

/**
 * Carries one app act the brain decided — a settings change, the panel shown,
 * the feedback composer brought up, the Updates row's button — to the renderer
 * that can perform it, and answers what became of it. The act was validated
 * against the guide in the main process before it got here; the carrier only
 * performs and reports. Nothing here sends a note: the feedback act opens the
 * composer, and what it holds leaves only by its own Send button.
 */
export type AppActionCarrier = (action: BrainAppActRequest["action"]) => Promise<WireRecord>;

export interface ConversationCallOptions extends SpeakOnlyCallOptions {
  /**
   * Answers the voice's one tool: the developer's words go to the brain under
   * the tool call's own id as the submission — so a call the service repeats
   * finds the same run — and what comes back is the reply for the voice to
   * say, the note that the run is still going, or a bounded refusal. Absent
   * means the voice can only speak for itself, and every ask is refused.
   */
  askBrain?: (question: string, submissionId: string) => Promise<BrainAskResult>;
  /**
   * The session document the call is configured with. The introduction's own
   * call declares no tools this way; absent, the conversation's ordinary
   * document stands.
   */
  sessionConfig?: (model: string) => BuiltRealtimeSessionConfig;
  requestMicrophoneStream?: () => Promise<MediaStream>;
  /**
   * The local PCM capture a press runs while its call is still connecting.
   * Injectable on the browser pieces' own terms: the cold-press seam is a
   * state machine worth testing without a real audio graph.
   */
  createPressCapture?: PressCaptureFactory;
  onLocalStream(stream: MediaStream | undefined): void;
  /**
   * The developer's own spoken turn, as the voice service transcribed it. It
   * arrives on the transcription's clock — often after the reply to it has
   * already begun. The caller records the words so the thread holds both
   * halves of the exchange.
   */
  onSpokenAsk?(transcript: string, itemId: string): void;
  /**
   * The developer's spoken words taking shape, one growing piece at a time.
   * Preview only: the caller may draw the ask as it is transcribed, but
   * records nothing until `onSpokenAsk` hands the settled words over — a turn
   * whose transcription fails previews and then leaves.
   */
  onSpokenAskDelta?(itemId: string, delta: string): void;
  /**
   * A spoken turn whose transcription the service gave up on. No completed
   * transcript is coming, so whatever preview the turn's deltas built must
   * leave rather than stand forever as words still arriving.
   */
  onSpokenAskFailed?(itemId: string): void;
  /** The local audio turn closed, before its commit can be acknowledged. */
  onSpokenAskClosed?(): void;
  /** The server item that fixes which current-launch history a spoken turn belongs to. */
  onSpokenAskCommitted?(itemId: string): void;
}

/** The developer's words as the voice handed them to the brain, or nothing worth asking. */
function askQuestion(argumentsJson: string): string | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the record and string checks are the validation.
    const parsed = JSON.parse(argumentsJson) as UnparsedWireValue;
    if (!isRecord(parsed)) return undefined;
    return text(parsed.question)?.trim().slice(0, maximumTypedAskLength) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Drives one Realtime conversation the developer can speak on: the speak-only
 * call with a capture device and the voice's one tool added.
 *
 * The capture device is the developer's, not the call's: it opens when a
 * press takes a turn and closes when the exchange that press started settles,
 * and nothing else — not connecting, not typing, not an announcement — ever
 * touches it. The SDK negotiates a generated silent track up front, so each
 * turn's fresh microphone track rides the same sender without renegotiating.
 * The press is held as a pending intention while the device
 * opens, exactly as a press that beats the call's handshake is. The close
 * waits for the settle rather than the key coming up because closing a
 * capture device is itself audible on shared hardware — a Bluetooth headset
 * renegotiates its codec — and the key comes up exactly as Luke starts to
 * answer; the track is disabled at that moment, and the device follows in
 * the quiet after the reply. What this buys is that the microphone and its
 * indicator are user-driven — one exchange, opened by one press — and that
 * other audio is never degraded by a device held while nobody is talking.
 */
export class ConversationCall extends SpeakOnlyCall<ConversationCallOptions> {
  #microphone: MediaStreamTrack | undefined;
  #stream: MediaStream | undefined;
  /**
   * The sender the microphone track rides. It outlives the track on purpose:
   * a released device leaves the sender on the call, silent, which is what
   * lets the next press attach a fresh track without renegotiating.
   */
  #microphoneSender: MicrophoneSender | undefined;
  #silenceTrack: MediaStreamTrack | undefined;
  /** The device being reopened, held so two presses cannot open it twice. */
  #acquiring: Promise<void> | undefined;
  /** The words a press speaks while its call is still connecting. */
  #press = new PressTurnCapture({
    send: (events) => this.send(events),
    createSource: this.options.createPressCapture,
    device: () => {
      const stream = this.#stream;
      const track = this.#microphone;
      if (!stream || !track) return undefined;
      return { stream, track, sender: this.#microphoneSender };
    },
    connected: () => this.isConnected,
  });
  /**
   * A press of the talk key that arrived before there was a call to press
   * against. The microphone opens only once the call is up, so such a press is
   * an intention rather than a turn.
   */
  #pendingTurn = false;
  /**
   * The calls an armed reply asked for, and whether the follow-up voicing
   * their outcomes is still owed. The turn holds through the writes — a READY
   * offered mid-write is the edge the announcer rides, and a reply taken
   * there bumps the epoch and abandons the follow-up — so the audio draining
   * then is remembered rather than an ending.
   */
  #tools = new ToolFollowUp({
    epoch: () => this.turnEpoch,
    connected: () => this.isConnected,
    openFollowUp: () => this.startResponse(functionCallFollowUpEvents(), { keepCaption: true }),
  });

  /**
   * Whether the call that is up — or coming up — is one the developer can take
   * a turn on. The developer's call whose device is resting between turns
   * still answers true: the call can take the turn, and the device rejoins it
   * on the press rather than a fresh call replacing it.
   */
  override get microphoneCall(): boolean {
    return this.isConnected || this.isConnecting;
  }

  /**
   * The conversation's own document: every tool the voice may call, unless
   * the caller supplies one of its own — the introduction's, which declares
   * none.
   */
  protected override sessionConfig(model: string): BuiltRealtimeSessionConfig {
    const supplied = this.options.sessionConfig?.(model);
    if (supplied) return supplied;
    return realtimeSessionConfig({ model, ...this.options.voice?.() });
  }

  /**
   * The talk key going down. Opening a turn and ending one are separate here
   * rather than one toggle, because a key that reports being let go of can say
   * which of the two it meant — and a turn that lasts exactly as long as the
   * key is held cannot be left open by forgetting to press again.
   */
  beginTurn(): void {
    // Every press opens the device: it lives exactly as long as the turn it
    // was pressed for. Until the device is live — and, on a first press, the
    // call it rides — the press waits as an intention and the turn opens the
    // moment both exist.
    if (!this.isConnected || !this.#microphone) {
      // The developer's turn wins at the press, not at the device: a reply
      // under way is cut off now, exactly as the stop key cuts one, and the
      // turn itself opens when the device arrives.
      this.stopSpeaking();
      this.#pendingTurn = true;
      this.#acquireMicrophone();
      return;
    }
    this.startListening();
  }

  /**
   * The talk key coming up on a held turn, or a second press ending a latched
   * one. A turn that never opened is dropped rather than committed: the
   * microphone opens with the press, and one that was let go of before the
   * device arrived captured nothing to send.
   */
  endTurn(commit: boolean): void {
    if (!this.isConnected) {
      this.#pendingTurn = false;
      if (commit && this.#press.active && !this.#press.empty) {
        // The press already spoke, so its words are owed a delivery once this
        // attempt's channel opens. The press no longer holds a turn, though:
        // the capture stops reading and the device closes this instant.
        this.#press.seal();
        this.#releaseMicrophone();
        return;
      }
      // Nothing was captured toward this press — the device never arrived,
      // or nothing was said into it — so the turn it was owed is dropped, as
      // committing it would ask the server to answer an empty buffer.
      this.#press.reset();
      this.#releaseMicrophone();
      return;
    }
    // A press let go of while its device was still opening held nothing of
    // its own to send: the turn it was owed is dropped rather than opened
    // under a key that is already up. But a re-press re-opens a sealed turn,
    // and the words sealed toward it are still owed — a commit delivers them
    // now, connected as we are, and a discard lets the whole turn go.
    if (!this.#microphone) {
      this.#pendingTurn = false;
      if (commit && this.#press.commitPending) this.#deliverHeldTurn();
      else this.#press.reset();
      return;
    }
    this.stopListening(commit);
  }

  /**
   * Whether a press is still waiting for a call that can take its turn. The
   * opening meter reads this: a takeover — the developer's call replacing
   * Luke's own — passes through a settled status on the way, and the meter
   * must not come down while the press that started it is still owed a turn.
   * A press released mid-connect with words captured is owed one too — its
   * delivery — so the meter rides until the reply to it begins.
   */
  get turnPending(): boolean {
    return this.#pendingTurn || this.#press.commitPending;
  }

  /**
   * Forgets a press that was waiting for a call that is not coming — a refused
   * microphone, say. Without this the intention would outlive the attempt and
   * open a turn out of the next connection, which nobody asked for.
   */
  dropPendingTurn(): void {
    this.#pendingTurn = false;
    // The words captured toward the dropped press go with it.
    this.#press.reset();
    // A device already opened for that press has no turn left to serve, and
    // nobody is talking into it: it closes now, not on any clock.
    if (this.status !== REALTIME_STATUS.LISTENING) this.#releaseMicrophone();
  }

  /**
   * Opens the microphone for as long as push-to-talk is held, reporting
   * whether it actually did. The caller uses that to decide whether to claim
   * the key it was pressed with — Space still scrolls the panel when there is
   * no turn to open.
   */
  startListening(): boolean {
    if (!this.#microphone || !this.isConnected) return false;
    if (this.status === REALTIME_STATUS.LISTENING) return false;
    // Talking over Luke stops it. The developer's turn always wins, which is
    // the whole point of a key that means "it is my turn now".
    if (this.status === REALTIME_STATUS.RESPONDING) this.interruptReply();
    // Start from an empty buffer: a muted track still transmits, and with turn
    // detection off the server keeps everything since the last commit.
    this.send(clearInputAudioEvents());
    this.#microphone.enabled = true;
    // The developer taking the turn is a new turn, whatever a tool follow-up
    // still in flight from the last one thinks: it will find this epoch and
    // stand down rather than talk over the microphone now opening.
    this.bumpTurnEpoch();
    this.setStatus(REALTIME_STATUS.LISTENING);
    return true;
  }

  /**
   * Closes the microphone and either asks for a reply or discards the turn.
   * Discarding matters: a press the developer changes their mind about must not
   * leave buffered audio behind for the next turn to inherit.
   */
  stopListening(commit: boolean): void {
    if (!this.#microphone || this.status !== REALTIME_STATUS.LISTENING) return;
    if (this.#press.onAppends) {
      // The captured turn ends here whichever way, and the seam settles with
      // it: the capture stops and the track joins the sender, so every turn
      // after this one rides WebRTC as before. The device itself is kept
      // exactly as a track turn keeps it — through the reply, released in
      // the quiet after it — for the same shared-hardware reason.
      this.#press.reset();
      this.#microphone.enabled = false;
      if (!commit) {
        this.send(clearInputAudioEvents());
        this.setStatus(REALTIME_STATUS.READY);
        return;
      }
      // The commit follows the last append on the same ordered channel, so it
      // closes over every word the capture delivered.
      this.startResponse(pushToTalkCommitEvents());
      return;
    }
    this.#microphone.enabled = false;
    if (!commit) {
      this.send(clearInputAudioEvents());
      // Settling to READY is what releases the device: nothing is coming
      // that its closing could talk over.
      this.setStatus(REALTIME_STATUS.READY);
      return;
    }
    // The developer opened this turn and spoke into it, so an ask the voice
    // makes of the brain out of it is the developer's own. The device is NOT
    // released here, deliberately: closing a capture device is itself audible
    // on shared hardware — a Bluetooth headset renegotiates its codec and
    // playback drops out for a beat — and this is the very moment Luke starts
    // to answer. The track is disabled, so nothing is sent; the device itself
    // is let go when the exchange settles, in the quiet after the reply.
    this.startResponse(pushToTalkCommitEvents());
  }

  /**
   * Speaks the brain's reply to a typed ask, reporting whether it could. The
   * ask itself went to the brain over the bridge — the voice never saw it —
   * so what the call is handed is the finished reply, on the briefing's own
   * out-of-band terms. A reply arriving over another interrupts it: the
   * developer's turn always wins, however it is taken.
   */
  speakReply(briefing: string, runId?: string): boolean {
    if (!this.isConnected) return false;
    if (this.status === REALTIME_STATUS.LISTENING) return false;
    const events = briefingSpeechEvents({
      kind: BRIEFING_SPEECH_KIND,
      briefing,
      decidedAt: Date.now(),
    });
    if (events.length === 0) return false;
    if (this.status === REALTIME_STATUS.RESPONDING) this.interruptReply();
    this.startResponse(events);
    this.setCaptionKind(REPLY_KIND.REPLY, runId);
    return true;
  }

  protected override onChannelOpen(): void {
    super.onChannelOpen();
    // Whoever pressed the talk key to get here has been waiting through the
    // handshake for their turn to open. The press already opened the device
    // and has been captured since it answered, so the turn opens on those
    // words — as appends, with the track joining the sender only when the
    // turn is over. A press whose device is still opening falls back to the
    // acquire, and its turn opens when the device arrives.
    if (this.#pendingTurn) {
      if (this.#press.active && this.#microphone) {
        this.#pendingTurn = false;
        this.#beginAppendsTurn();
      } else {
        this.#acquireMicrophone();
      }
    } else if (this.#press.commitPending) {
      // The press was released mid-handshake. Its words go as the turn it
      // held — one tick later, because the caller re-feeds the roster and
      // the guide right after this connect resolves, and the reply to those
      // words must be answered from that context rather than from none.
      setTimeout(() => this.#deliverHeldTurn(), 0);
    }
  }

  protected override onConnectFailed(): void {
    // The words a press captured are under the same rule: the teardown each
    // failing path runs has already discarded them, and this clears the
    // delivery they were owed.
    this.#pendingTurn = false;
    this.#press.reset();
  }

  protected override onStatusChanged(status: RealtimeStatus): void {
    // The exchange settling is what closes the device the press opened — not
    // the commit itself, because closing a capture device is audible on
    // shared hardware (a Bluetooth headset renegotiates its codec), and at
    // the commit Luke is just starting to answer. Here the reply is over and
    // the blip lands in the quiet. A press already waiting keeps the device:
    // its turn is about to reuse it.
    if (status === REALTIME_STATUS.READY && !this.#pendingTurn) this.#releaseMicrophone();
  }

  protected override onPeerConnection(
    peer: RTCPeerConnection,
    silenceTrack: MediaStreamTrack,
  ): void {
    const sender = peer.getSenders().find((candidate) => candidate.track === silenceTrack);
    if (!sender) throw new Error("The voice connection did not provide an audio sender.");
    this.#silenceTrack = silenceTrack;
    this.#microphoneSender = sender;
    super.onPeerConnection(peer, silenceTrack);
  }

  protected override onTeardown(step: TeardownStep): void {
    // The capture retires while the track is still known — so it can close
    // it — and the channel is already down, so retirement hands no track to a
    // sender: there is no call left to carry it, and the words the capture
    // still held die with the attempt.
    step(() => this.#press.reset());
    this.#microphone = undefined;
    this.#microphoneSender = undefined;
    this.#silenceTrack = undefined;
    const stream = this.#stream;
    this.#stream = undefined;
    let tracks: readonly MediaStreamTrack[] = [];
    step(() => {
      tracks = stream?.getTracks() ?? [];
    });
    for (const track of tracks) step(() => track.stop());
    super.onTeardown(step);
    this.#pendingTurn = false;
    step(() => this.options.onLocalStream(undefined));
  }

  protected override onRawRecord(record: WireRecord): void {
    this.#tools.observe(record);
  }

  protected override handleEvent(event: ParsedRealtimeServerEvent): void {
    switch (event.type) {
      case REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA:
        this.options.onSpokenAskDelta?.(event.itemId, event.delta);
        return;
      case REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED:
        this.options.onSpokenAsk?.(event.transcript, event.itemId);
        return;
      case REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_FAILED:
        this.options.onSpokenAskFailed?.(event.itemId);
        return;
      case REALTIME_SERVER_EVENT.INPUT_AUDIO_BUFFER_COMMITTED:
        this.options.onSpokenAskCommitted?.(event.itemId);
        return;
      default:
        super.handleEvent(event);
    }
  }

  protected override onResponseStarted(events: readonly WireRecord[]): void {
    if (events.some((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT)) {
      this.options.onSpokenAskClosed?.();
    }
  }

  protected override onResponseCreated(responseId: string): void {
    this.#tools.opened(responseId);
  }

  protected override replyResumes(event: ResponseDoneEvent, fresh: boolean): boolean {
    const resumes = this.#tools.done({
      responseId: event.responseId,
      callIds: event.calls.map((call) => call.callId),
      fresh,
    });
    if (!resumes) return false;
    // The turn now holds for the follow-up, because the READY an ending here
    // would offer while the brain thinks is the edge the queue rides — a
    // briefing taken there bumps the epoch, and the follow-up voicing the
    // answer stands down against it, the developer's answer abandoned for a
    // briefing. The hold is the ask's, so it gets a clock of its own, long
    // enough for a brain turn that reads and acts before it answers — while
    // an ask that hangs past even that still meets a backstop, because a turn
    // that never ends is worse than one that ends early.
    this.clearSettleTimer();
    this.armSettleTimer(BRAIN_ASK_SETTLE_TIMEOUT_MS);
    this.#tools.startIfReady();
    return true;
  }

  protected override get turnHolds(): boolean {
    return this.#tools.holds;
  }

  protected override onTurnBoundary(): void {
    this.#tools.reset();
  }

  protected override async executeTool(
    expectedName: string,
    details: SdkToolCallDetails | undefined,
  ): Promise<WireRecord> {
    const toolCall = details?.toolCall;
    const callId = toolCall?.callId;
    const name = toolCall?.name;
    if (toolCall?.type !== "function_call" || !callId || name !== expectedName) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "The tool call was malformed." };
    }
    const argumentsJson = toolCall.arguments;
    if (argumentsJson === undefined) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "The tool arguments were malformed." };
    }
    // Only the reply now under way may ask the brain: a cancelled reply's
    // late call — the developer already talked over it — is answered with a
    // refusal rather than an ask the developer moved on from.
    return this.#toolCallOutput({ name, callId, argumentsJson }, this.#tools.current(callId));
  }

  protected override onToolOutputSent(callId: string): void {
    this.#tools.outputSent(callId);
  }

  /**
   * Answers the voice's one tool. The developer's words go to the brain over
   * the bridge, and what comes back — the reply, or a bounded refusal — is
   * the tool's output, for the follow-up to say. The brain acts on its own
   * side behind its own validators; nothing here performs anything.
   */
  async #toolCallOutput(call: ParsedRealtimeFunctionCall, current: boolean): Promise<WireRecord> {
    if (!current) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That turn is over; ask again if it still matters.",
      };
    }
    if (call.name !== ASK_BRAIN_TOOL.name) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such tool exists." };
    }
    const question = askQuestion(call.argumentsJson);
    if (!question) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "The ask carried no words." };
    }
    if (!this.options.askBrain) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Luke's judgment is not available on this call.",
      };
    }
    // The ask can take a while — a brain turn reads and may act — so the
    // turn's backstop is stretched to the ask's own clock for its duration.
    this.clearSettleTimer();
    this.armSettleTimer(BRAIN_ASK_SETTLE_TIMEOUT_MS);
    const epoch = this.turnEpoch;
    let answer: BrainAskResult;
    try {
      answer = await this.options.askBrain(question, call.callId);
    } catch {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Luke's judgment did not answer.",
      };
    }
    if (answer.status === BRAIN_ASK_PENDING_STATUS) {
      // The run goes on without this turn: the follow-up says so, and the
      // turn is released rather than held open for a reply that may be a
      // long time coming.
      return { status: answer.status, note: answer.note };
    }
    if (answer.status !== ACT_RESULT_STATUS.ACCEPTED) {
      return { status: answer.status, reason: answer.reason };
    }
    // The follow-up that says the answer is the reply now under way, and its
    // words are the brain's — marked here, before the follow-up opens with the
    // caption kept. Unless the developer stopped or took the turn while the
    // ask was out: the follow-up stands down on that edge, and a late answer
    // must not mark words that will never be said. The answer itself still
    // travels, because the brain did what it says it did.
    if (epoch === this.turnEpoch) this.setCaptionKind(REPLY_KIND.REPLY, answer.runId);
    return { briefing: answer.briefing };
  }

  /**
   * How the device is asked for — only ever on behalf of a press. The caller
   * usually injects the route-aware opener; the fallback opens the browser's
   * default with the same processing (`MICROPHONE_PROCESSING` says why echo
   * cancellation is off), so a bare call still captures correctly.
   */
  #requestStream(): Promise<MediaStream> {
    return (
      this.options.requestMicrophoneStream?.() ??
      navigator.mediaDevices.getUserMedia({ audio: { ...MICROPHONE_PROCESSING }, video: false })
    );
  }

  /**
   * Opens the capture device for the press waiting on it. One request at a
   * time: a second press mid-open joins the first rather than racing it. A
   * press ahead of the call opens the device too — the capture beside the
   * handshake is what carries the words spoken into it — so being connected
   * is not required.
   */
  #acquireMicrophone(): void {
    if (this.#microphone) return;
    if (this.#acquiring) return;
    this.#acquiring = this.#openMicrophone().finally(() => {
      this.#acquiring = undefined;
      // A press that arrived while a stale open was still in flight was told
      // to wait by the guard above; with the flight over, it is served now.
      if (this.#pendingTurn && !this.#microphone) this.#acquireMicrophone();
    });
  }

  async #openMicrophone(): Promise<void> {
    // The attempt names the call — or the connect under way — this open
    // belongs to, captured before the wait: one closed and replaced while the
    // device was opening keeps a fresh token, which is how this open knows it
    // has gone stale. The sender cannot stand for the call here, because a
    // press ahead of the handshake opens the device before any sender exists.
    const attempt = this.attempt;
    let stream: MediaStream;
    try {
      stream = await this.#requestStream();
    } catch (error) {
      // A refusal belongs to the attempt whose press asked for the device. If
      // that attempt is gone — closed, or replaced mid-open — the refusal
      // died with it, and the call now up must not be torn down for it. On a
      // call already standing it is failed rather than left looking able to
      // listen, and `FAILED` offers "Start voice" again; mid-connect the call
      // the press is still waiting for goes on opening, the press is dropped —
      // there is nothing to capture with — and the refusal is shown beside it.
      if (this.closed || attempt !== this.attempt) return;
      const message = error instanceof Error ? error.message : String(error);
      if (this.isConnected) {
        this.fail(message);
        return;
      }
      this.#pendingTurn = false;
      this.options.onError(message);
      return;
    }
    // The attempt may have gone away while the device was opening. A device
    // nobody adopts is released here, or it would hold the indicator lit with
    // nothing left to close it.
    if (this.closed || attempt !== this.attempt || this.#microphone) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const [microphone] = stream.getAudioTracks();
    if (!microphone) {
      for (const track of stream.getTracks()) track.stop();
      if (this.isConnected) {
        this.fail("No microphone track was available.");
      } else {
        this.#pendingTurn = false;
        this.options.onError("No microphone track was available.");
      }
      return;
    }
    // Closed until the turn opens it, so nothing is sent before the state
    // machine says the turn is on.
    microphone.enabled = false;
    this.#stream = stream;
    this.#microphone = microphone;
    this.options.onLocalStream(stream);
    if (!this.isConnected) {
      // The call is still connecting, and the press is waiting it out: the
      // words start being captured now, and the turn they open travels as
      // appends — the track joins the sender only when that turn is over. A
      // press already let go of leaves nothing to capture for, so the device
      // closes as fast as it arrived.
      if (this.#pendingTurn) this.#press.begin();
      else this.#releaseMicrophone();
      return;
    }
    if (this.#pendingTurn && this.#press.active) {
      // The device arrived connected, for a re-press over sealed words — the
      // channel opened while it was still on its way. The turn it re-opened
      // still owes those words, and a track turn would start by clearing
      // them: so the turn opens as the captured turn it began as, resuming
      // capture on the device that just arrived, and the track joins the
      // sender at the seam as every captured turn's does.
      this.#press.begin();
      this.#pendingTurn = false;
      this.#beginAppendsTurn();
      return;
    }
    const sender = this.#microphoneSender;
    if (!sender) {
      // A connected call always negotiated a sender; without one there is
      // nothing for a turn to ride, and the device has no taker.
      this.#releaseMicrophone();
      return;
    }
    try {
      // Onto the sender the call has kept since its handshake: no
      // renegotiation, the same line, the same call.
      await sender.replaceTrack(microphone);
    } catch (error) {
      // Guarded like the open's own refusal: a sender that rejected because
      // its call was torn down mid-replace is not the live call's fault.
      if (!this.closed && attempt === this.attempt && this.isConnected) {
        if (error instanceof Error) this.fail(error.message);
        else this.fail(String(error));
      }
      return;
    }
    if (this.closed || !this.isConnected) return;
    if (this.#pendingTurn) {
      this.#pendingTurn = false;
      this.startListening();
      return;
    }
    // Opened for a press that has since been let go: nobody is talking, so
    // the device closes as fast as it arrived.
    this.#releaseMicrophone();
  }

  /**
   * Puts the capture device away without touching the call: the tracks stop,
   * the sender stays to take the next track, and the meter lets go of a
   * stream that no longer exists. From here the microphone indicator is dark
   * and Bluetooth audio is back on its music codec.
   */
  #releaseMicrophone(): void {
    if (!this.#stream && !this.#microphone) return;
    const stream = this.#stream;
    this.#stream = undefined;
    this.#microphone = undefined;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    void this.#microphoneSender?.replaceTrack(this.#silenceTrack ?? null);
    this.options.onLocalStream(undefined);
  }

  /**
   * Opens the turn a still-held press has been capturing: `startListening` in
   * every respect but the transport.
   */
  #beginAppendsTurn(): void {
    if (!this.#press.active || !this.#microphone) {
      this.#acquireMicrophone();
      return;
    }
    this.#press.openTurn();
    this.bumpTurnEpoch();
    this.setStatus(REALTIME_STATUS.LISTENING);
  }

  /**
   * Delivers the turn a press held and released while the call was still
   * connecting: the captured words flush as appends and commit as the turn
   * the release already closed. It runs a tick after the channel opened so
   * the caller's context re-feed lands first, and it yields to anything that
   * moved in that tick — a new turn is the developer talking again, and words
   * that yielded are discarded rather than queued behind it.
   */
  #deliverHeldTurn(): void {
    if (!this.#press.active || !this.#press.commitPending) return;
    if (this.closed || !this.isConnected || voiceExchangeActive(this.status)) {
      this.#press.reset();
      return;
    }
    if (!this.#press.deliverSealed()) return;
    // A turn exactly as a live commit is: the developer opened it by holding
    // the key and spoke into it; only the delivery waited.
    this.startResponse(pushToTalkCommitEvents());
  }
}
