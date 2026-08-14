import {
  type AppGuideSnapshot,
  type AppToolAction,
  type AttentionSpeech,
  appGuideContextEvents,
  appGuideContextText,
  appToolAction,
  cancelResponseEvents,
  clearInputAudioEvents,
  EMPTY_APP_GUIDE,
  functionCallFollowUpEvents,
  functionCallOutputEvents,
  type IssueToolAction,
  isAppToolCall,
  isIssueToolName,
  isSessionToolName,
  issueContextEvents,
  issueContextText,
  issueToolAction,
  issueTrackerDisconnectedEvents,
  type NormalizedSession,
  type ObservedWorkspaceProject,
  outputSpeedUpdateEvents,
  proactiveSpeechEvents,
  pushToTalkCommitEvents,
  REALTIME_DATA_CHANNEL,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeConnection,
  type RealtimeFunctionCall,
  type RealtimeStatus,
  realtimeFunctionCalls,
  type SessionToolAction,
  sessionContextEvents,
  sessionContextText,
  sessionToolAction,
  type TrackedIssue,
  truncateResponseEvents,
  typedAskEvents,
  workspaceProjectContextEvents,
  workspaceProjectContextText,
} from "@sidecar/core";

const SDP_CONTENT_TYPE = "application/sdp";

/** Bounds the SDP exchange and the data channel opening, together. */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * How long a finished generation may go on playing before the turn is ended
 * anyway. It is a backstop for a reply that produced no audio at all, not the
 * normal path: a spoken reply ends when it goes quiet.
 */
const REALTIME_SETTLE_TIMEOUT_MS = 20_000;

/**
 * Carries one validated action to the process that can perform it, answering
 * with what became of it. The renderer validates a tool call against the
 * observed roster before this is called, and the main process validates it
 * again against its registry — the carrier is a courier, not a gate.
 */
export type SessionActionCarrier = (
  action: Extract<
    SessionToolAction,
    { kind: "message" | "control" | "open" | "create-workspace" | "add-agent" }
  >,
) => Promise<Record<string, unknown>>;

/**
 * Carries one validated app-level act — a settings change, the panel being
 * shown, or the feedback composer brought up — to the renderer that can
 * perform it. The same posture as the session carrier: validation happened
 * against the guide before this is called, and the carrier only performs and
 * reports. Nothing here sends a note: the feedback act opens the composer,
 * and what it holds leaves only by its own Send button.
 */
export type AppActionCarrier = (
  action: Extract<AppToolAction, { kind: "setting" | "panel" | "feedback" }>,
) => Promise<Record<string, unknown>>;

/** The issue half of the same courier: validated here, validated again in main. */
export type IssueActionCarrier = (
  action: Extract<IssueToolAction, { kind: "issue-state" | "issue-comment" }>,
) => Promise<Record<string, unknown>>;

export interface RealtimeVoiceSessionCallbacks {
  onStatus(status: RealtimeStatus): void;
  onLocalStream(stream: MediaStream | undefined): void;
  onRemoteStream(stream: MediaStream | undefined): void;
  onError(message: string | undefined): void;
  /**
   * The text of the reply Luke is currently speaking, growing as it is
   * generated, or undefined once there is nothing being spoken. The session
   * owns the whole lifecycle — the caption clears when the reply ends, is cut
   * off, or the call closes — so the caller only ever draws what it is handed.
   */
  onCaption(text: string | undefined): void;
}

export interface RealtimeVoiceSessionOptions extends RealtimeVoiceSessionCallbacks {
  requestConnection(): Promise<RealtimeConnection | undefined>;
  /** Absent means Luke can only speak: every tool call is refused with a reason. */
  carryAction?: SessionActionCarrier;
  /** Absent means spoken asks about Luke himself are refused with a reason. */
  carryAppAction?: AppActionCarrier;
  /** Absent means issues can only be recited: every issue call is refused. */
  carryIssueAction?: IssueActionCarrier;
  /**
   * The browser pieces, injectable so the microphone state machine can be
   * exercised without a real device or peer connection. Push-to-talk decides
   * when a microphone is live, which is worth testing directly.
   */
  createPeerConnection?: () => RTCPeerConnection;
  requestMicrophoneStream?: () => Promise<MediaStream>;
  exchangeDescription?: (url: string, init: RequestInit) => Promise<Response>;
  connectTimeoutMs?: number;
  /** Injectable so a test can hold the clock a truncate measures against. */
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/**
 * Whether a quiet stretch is Luke's to answer for.
 *
 * One meter draws both halves of the conversation, so it goes quiet twice for
 * reasons that have nothing to do with Luke: while it lets go of the
 * microphone as a turn is committed, and again in the gap before the first
 * word comes back. Ending a reply on either takes his waveform down seconds
 * after it appeared, while he is still speaking.
 *
 * So silence only counts once the reply is his and something has been heard of
 * it. Nothing here decides when a reply is over — that is the generation being
 * finished as well — only whose silence is being read.
 */
export function quietIsLukesOwn(input: { status: RealtimeStatus; heardLuke: boolean }): boolean {
  return input.status === REALTIME_STATUS.RESPONDING && input.heardLuke;
}

/**
 * Drives one Realtime conversation over WebRTC.
 *
 * The microphone track is created once and kept disabled, so push-to-talk
 * enables an existing track rather than reopening the device. That keeps the
 * macOS microphone indicator honest: it lights up while Luke is connected, and
 * the UI states separately whether audio is actually being sent.
 */
export class RealtimeVoiceSession {
  readonly #options: RealtimeVoiceSessionOptions;
  #peer: RTCPeerConnection | undefined;
  #channel: RTCDataChannel | undefined;
  #microphone: MediaStreamTrack | undefined;
  #stream: MediaStream | undefined;
  #status: RealtimeStatus = REALTIME_STATUS.IDLE;
  #connecting: Promise<boolean> | undefined;
  #closed = false;
  #sessionContext: string | undefined;
  /**
   * The roster as last reported, kept whole rather than as its rendered text:
   * it is what a tool call is validated against, and a call may only name a
   * session Luke was actually shown.
   */
  #sessions: readonly NormalizedSession[] = [];
  /**
   * The app guide as last provided, kept whole for the same reason the roster
   * is: it is what a spoken ask about Luke himself is validated against, and a
   * call may only name a setting Luke was actually described as having.
   */
  #guide: AppGuideSnapshot = EMPTY_APP_GUIDE;
  #guideContext: string | undefined;
  /**
   * The projects a workspace can be created in, as last reported — kept whole
   * for the same reason the roster is: a spoken creation ask may only name a
   * project Luke was actually shown.
   */
  #workspaceProjects: readonly ObservedWorkspaceProject[] = [];
  #workspaceProjectContext: string | undefined;
  /**
   * The issue roster, held to the same rule — and `undefined` while no
   * tracker is connected, so an issue call then has nothing to be validated
   * against and is refused as such.
   */
  #issues: readonly TrackedIssue[] | undefined;
  #issueContext: string | undefined;
  /**
   * Luke's own audio track. Cancelling stops the model producing more, but what
   * it already produced is on its way down the connection and keeps playing —
   * so cutting him off means silencing this end too, which is the only half of
   * it entirely under our control.
   */
  #remoteTrack: MediaStreamTrack | undefined;
  /**
   * Whether the model has finished producing the reply. It is not the same as
   * the reply being over: `response.done` says generation is complete, and the
   * audio it produced is still on its way out. A turn that ended here would
   * take the meter and the face down while Luke was still audible, and would
   * let the next press start a turn over the top of him.
   */
  #generationDone = false;
  /**
   * Whether Luke has been quiet since he was last heard. Generation finishing
   * and playback finishing are two events with no fixed order, and only one of
   * them arrives twice: the meter reports an edge, so a quiet that lands before
   * `response.done` is the only quiet there will be. Remembering it is what
   * lets the second of the two end the turn, whichever one that turns out to
   * be.
   */
  #remoteQuiet = false;
  /**
   * A press of the talk key that arrived before there was a call to press
   * against. The microphone opens only once the call is up, so such a press is
   * an intention rather than a turn.
   */
  #pendingTurn = false;
  /**
   * The message Luke's current reply is being spoken into, and the moment it
   * first became audible. Together they are what a truncate needs: which
   * message to cut, and how much of it reached the room.
   */
  #responseItemId: string | undefined;
  /**
   * The response now under way, as the server named it when it confirmed the
   * reply had started — or nothing between asking for a reply and that
   * confirmation. It is what tells the current reply's `response.done` from a
   * cancelled one's: the server had finished composing the old reply before
   * the cancel landed, so its `done` still arrives, and it can carry tool
   * calls. Matching the id is what keeps those calls from being answered with
   * the new turn's arming — the turn that superseded them, not the one that
   * asked.
   */
  #activeResponseId: string | undefined;
  #audibleSince: number | undefined;
  /**
   * The words of the reply being spoken, as far as they have arrived. Kept
   * here rather than in the caller so every path that ends a reply — finishing,
   * being talked over, the call dropping — clears the words with it, and a
   * caption can never outlive the speech it captions.
   */
  #caption: string | undefined;
  /**
   * Whether this call has ever reported a reply's audio running out. Once it
   * has, silence stops being evidence of anything: the server says when Luke is
   * finished, and a stretch of quiet is just as likely to be the gap between
   * two sentences. Calls that never report one keep the old guess, because a
   * turn that never ends is worse than one that ends early.
   */
  #audioEndingsReported = false;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Whether the turn now under way is one the developer opened themselves — by
   * speaking, or by typing an ask — and so the one and only kind of turn a tool
   * call may run in. It is set true when a push-to-talk commit or a typed ask
   * opens a response and false for every turn Luke opens himself — a proactive
   * readout, the reply that voices a tool's outcome — so a session summary or a
   * tool output that reads like an instruction can never make Luke act. Nothing
   * that decides on the developer's behalf reaches a write path; this is the
   * runtime half of that, beside the standing instructions and the
   * `tool_choice` withheld on every turn Luke opens himself.
   */
  #toolTurnArmed = false;
  /**
   * A monotonic id for the turn now under way, bumped whenever a new one
   * begins. A tool follow-up captures it before awaiting the write and refuses
   * to open if it has changed — the developer has taken the turn, or started
   * another — so Luke never speaks the outcome over a live microphone or over
   * a reply the developer is already hearing.
   */
  #turnEpoch = 0;
  /**
   * A pace change that arrived mid-reply, waiting for the reply to end. The
   * API applies a speed only between model turns, so one landing while Luke is
   * speaking is held here and sent ahead of whatever the call does next.
   */
  #pendingSpeed: number | undefined;

  constructor(options: RealtimeVoiceSessionOptions) {
    this.#options = options;
  }

  get status(): RealtimeStatus {
    return this.#status;
  }

  get isConnected(): boolean {
    return this.#channel?.readyState === "open";
  }

  /** Opens the call, reusing an in-flight attempt rather than racing a second one. */
  async connect(): Promise<boolean> {
    if (this.isConnected) return true;
    this.#connecting ??= this.#connect()
      .then((opened) => {
        // A press does not outlive the attempt it started. Every way a connect
        // ends without a call passes through here — no credential, a refused
        // call, a timeout — so none of them can leave an intention behind for
        // some later connection to open a turn nobody asked for.
        if (!opened) this.#pendingTurn = false;
        return opened;
      })
      .finally(() => {
        this.#connecting = undefined;
      });
    return this.#connecting;
  }

  async #connect(): Promise<boolean> {
    this.#closed = false;
    this.#setStatus(REALTIME_STATUS.CONNECTING);
    this.#options.onError(undefined);

    // The whole of the wait before the handshake is these two, and neither
    // needs the other: the credential is minted over the network while the
    // capture device opens. `allSettled` rather than `all`, because whichever
    // one loses still has to be dealt with — a device that opened after a
    // failed mint would be held with nobody left to release it.
    const [connectionResult, streamResult] = await Promise.allSettled([
      this.#options.requestConnection(),
      this.#options.requestMicrophoneStream?.() ??
        navigator.mediaDevices.getUserMedia({
          audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
          video: false,
        }),
    ]);
    // Adopt the device before deciding anything, so every exit from here — a
    // stop that landed mid-mint, a failed mint, no credential at all — releases
    // it through the same teardown as the rest.
    if (streamResult.status === "fulfilled") this.#stream = streamResult.value;

    // A stop that lands while the credential is being minted is not a fault
    // to report. Every exit from here has to ask, not just the ones after the
    // handshake starts.
    if (this.#closed) return this.#abandonConnect();
    if (connectionResult.status === "rejected") {
      return this.#fail(
        `Could not reach the main process: ${errorMessage(connectionResult.reason)}`,
      );
    }
    const connection = connectionResult.value;
    if (!connection) {
      this.#teardown();
      this.#setStatus(REALTIME_STATUS.UNAVAILABLE);
      return false;
    }
    if (streamResult.status === "rejected") {
      return this.#fail(errorMessage(streamResult.reason));
    }

    try {
      const stream = streamResult.value;
      const [microphone] = stream.getAudioTracks();
      if (!microphone) throw new Error("No microphone track was available");
      // Push-to-talk starts closed. Nothing is sent until the developer asks.
      microphone.enabled = false;
      this.#microphone = microphone;
      this.#options.onLocalStream(stream);

      const peer = this.#options.createPeerConnection?.() ?? new RTCPeerConnection();
      this.#peer = peer;
      peer.addTrack(microphone, stream);
      peer.ontrack = (event) => {
        this.#remoteTrack = event.track;
        this.#options.onRemoteStream(event.streams[0]);
      };
      peer.onconnectionstatechange = () => {
        if (this.#closed) return;
        // `disconnected` is recoverable in WebRTC — ICE routinely passes through
        // it on a brief network blip — so only a terminal state ends the call.
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          this.#fail("The voice connection dropped.");
        }
      };

      const channel = peer.createDataChannel(REALTIME_DATA_CHANNEL);
      this.#channel = channel;
      channel.onmessage = (event) => this.#handleServerEvent(event.data);
      channel.onclose = () => {
        if (this.#closed) return;
        // A channel that closes on its own still leaves the capture running,
        // so this has to release the device as thoroughly as an explicit stop.
        this.#teardown();
        this.#setStatus(REALTIME_STATUS.IDLE);
      };

      // One deadline covers the SDP exchange and the channel opening together.
      // Without it a stalled endpoint leaves the panel on "Connecting…" forever,
      // with the only control that could recover it disabled.
      const timeoutMs = positiveInteger(this.#options.connectTimeoutMs, CONNECT_TIMEOUT_MS);
      const deadline = AbortSignal.timeout(timeoutMs);

      await peer.setLocalDescription(await peer.createOffer());
      const answer = await this.#exchangeDescription(
        connection,
        peer.localDescription?.sdp ?? "",
        deadline,
      );
      if (answer === undefined) return false;
      await peer.setRemoteDescription({ type: "answer", sdp: answer });

      await this.#waitForChannel(channel, deadline);
      if (this.#closed) return this.#abandonConnect();
      this.#setStatus(REALTIME_STATUS.READY);
      // Whoever pressed the talk key to get here has been waiting through the
      // handshake for their turn to open.
      if (this.#pendingTurn) {
        this.#pendingTurn = false;
        this.startListening();
      }
      return true;
    } catch (error) {
      if (this.#closed) return this.#abandonConnect();
      return this.#fail(errorMessage(error));
    }
  }

  /**
   * Releases everything a cancelled connect had already acquired, leaving the
   * session idle as the caller that stopped it intended.
   */
  #abandonConnect(): boolean {
    this.#teardown();
    this.#setStatus(REALTIME_STATUS.IDLE);
    return false;
  }

  async #exchangeDescription(
    connection: RealtimeConnection,
    offer: string,
    deadline: AbortSignal,
  ): Promise<string | undefined> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.value}`,
        "content-type": SDP_CONTENT_TYPE,
      },
      body: offer,
      signal: deadline,
    };
    const response = await (this.#options.exchangeDescription?.(connection.callsUrl, init) ??
      fetch(connection.callsUrl, init));
    if (!response.ok) {
      // The status is the diagnosable part; the ephemeral secret never is.
      this.#fail(`The voice service refused the call (status ${response.status}).`);
      return undefined;
    }
    return response.text();
  }

  #waitForChannel(channel: RTCDataChannel, deadline: AbortSignal): Promise<void> {
    if (channel.readyState === "open") return Promise.resolve();
    // The deadline is shared with the SDP exchange and can already have fired
    // by the time this waiter is armed, in which case no future `abort` event
    // is coming and listening alone would wait forever.
    if (deadline.aborted) {
      return Promise.reject(new Error("The voice connection timed out while opening."));
    }
    return new Promise((resolve, reject) => {
      const settle = (outcome: () => void) => {
        deadline.removeEventListener("abort", onDeadline);
        outcome();
      };
      const onDeadline = () =>
        settle(() => reject(new Error("The voice connection timed out while opening.")));
      deadline.addEventListener("abort", onDeadline, { once: true });
      channel.onopen = () => settle(resolve);
      channel.onerror = () =>
        settle(() => reject(new Error("The voice data channel failed to open")));
    });
  }

  /**
   * Starts a turn, ends one, or interrupts a reply — whichever the current
   * state makes it. One key drives the whole conversation, so what a press
   * means lives in one place rather than at every call site.
   */
  /**
   * The talk key going down. Opening a turn and ending one are separate here
   * rather than one toggle, because a key that reports being let go of can say
   * which of the two it meant — and a turn that lasts exactly as long as the
   * key is held cannot be left open by forgetting to press again.
   */
  beginTurn(): void {
    if (!this.isConnected) {
      this.#pendingTurn = true;
      return;
    }
    this.startListening();
  }

  /**
   * The talk key coming up on a held turn, or a second press ending a latched
   * one. A turn that never opened is dropped rather than committed: the
   * microphone opens with the call, so there is nothing behind it to send.
   */
  endTurn(commit: boolean): void {
    if (!this.isConnected) {
      this.#pendingTurn = false;
      return;
    }
    this.stopListening(commit);
  }

  toggleTurn(): void {
    // Before the call is up there is no turn to take: the microphone is enabled
    // only once the connection exists, so a press here cannot have captured
    // anything. It is remembered and applied when the call opens — and a second
    // press cancels the first rather than queueing another, because two presses
    // have always meant a turn opened and closed, and one that held nothing is
    // one with nothing to send.
    if (!this.isConnected) {
      this.#pendingTurn = !this.#pendingTurn;
      return;
    }
    if (this.#status === REALTIME_STATUS.LISTENING) {
      this.stopListening(true);
      return;
    }
    this.startListening();
  }

  /** Whether a call is being opened, so a press has something to wait for. */
  get isConnecting(): boolean {
    return this.#connecting !== undefined;
  }

  /**
   * Forgets a press that was waiting for a call that is not coming — a refused
   * microphone, say. Without this the intention would outlive the attempt and
   * open a turn out of the next connection, which nobody asked for.
   */
  dropPendingTurn(): void {
    this.#pendingTurn = false;
  }

  /**
   * Whether a turn is already under way in either direction.
   *
   * The Realtime API answers one turn at a time, so this is the whole of the
   * arbitration: while a turn is open, nothing else starts one. Callers are
   * told they were refused and decide what to show instead.
   */
  get #turnBusy(): boolean {
    return (
      this.#status === REALTIME_STATUS.LISTENING || this.#status === REALTIME_STATUS.RESPONDING
    );
  }

  /**
   * Opens the microphone for as long as push-to-talk is held, reporting
   * whether it actually did. The caller uses that to decide whether to claim
   * the key it was pressed with — Space still scrolls the panel when there is
   * no turn to open.
   */
  startListening(): boolean {
    if (!this.#microphone || !this.isConnected) return false;
    if (this.#status === REALTIME_STATUS.LISTENING) return false;
    // Talking over Luke stops it. The developer's turn always wins, which is
    // the whole point of a key that means "it is my turn now".
    if (this.#status === REALTIME_STATUS.RESPONDING) this.#interruptReply();
    // Start from an empty buffer: a muted track still transmits, and with turn
    // detection off the server keeps everything since the last commit.
    this.#send(clearInputAudioEvents());
    this.#microphone.enabled = true;
    // The developer taking the turn is a new turn, whatever a tool follow-up
    // still in flight from the last one thinks: it will find this epoch and
    // stand down rather than talk over the microphone now opening.
    this.#turnEpoch += 1;
    this.#setStatus(REALTIME_STATUS.LISTENING);
    return true;
  }

  /**
   * Closes the microphone and either asks for a reply or discards the turn.
   * Discarding matters: a press the developer changes their mind about must not
   * leave buffered audio behind for the next turn to inherit.
   */
  stopListening(commit: boolean): void {
    if (!this.#microphone || this.#status !== REALTIME_STATUS.LISTENING) return;
    this.#microphone.enabled = false;
    if (!commit) {
      this.#send(clearInputAudioEvents());
      this.#setStatus(REALTIME_STATUS.READY);
      return;
    }
    // A turn a tool may run in: the developer opened it and spoke into it, so
    // a tool call it emits is the developer's own ask.
    this.#startResponse(pushToTalkCommitEvents(), true);
  }

  /**
   * Sends a typed ask and requests the reply to it, reporting whether it
   * could. Typing is the developer opening a turn, exactly as holding the talk
   * key is, so the turn is armed for tools on the same terms as a push-to-talk
   * commit: a write out of it is the developer's own request, made in their
   * own words.
   *
   * An ask arriving over a reply interrupts it — the developer's turn always
   * wins, however it is taken. The one thing it will not interrupt is the
   * developer's own open microphone: half a spoken question is still theirs,
   * and a keystroke is no reason to discard it.
   */
  sendText(text: string): boolean {
    if (!this.isConnected) return false;
    if (this.#status === REALTIME_STATUS.LISTENING) return false;
    const events = typedAskEvents(text);
    if (events.length === 0) return false;
    if (this.#status === REALTIME_STATUS.RESPONDING) this.#interruptReply();
    this.#startResponse(events, true);
    return true;
  }

  /**
   * Cuts off the reply under way so the developer's new turn does not land on
   * top of it.
   */
  #interruptReply(): void {
    // Stop the words that are already on their way, then stop more being
    // made. A disabled track drops what is buffered rather than playing it
    // out, so the cut-off is immediate rather than eventual.
    this.#silenceLuke();
    // The caption is cut with the audio. It already held words the room
    // never heard — the text runs ahead of the speech — and leaving them up
    // would show Luke finishing a sentence he was just stopped from saying.
    this.#setCaption(undefined);
    this.#send(cancelResponseEvents());
    // Then correct what Luke believes he said, or the next answer is free to
    // refer back to a sentence that never reached the room.
    this.#send(this.#truncateEvents());
    // The trim was this reply's last word: forgetting its item here is what
    // stops the transcript still trailing in — the server had produced it
    // before the cancel landed — from ever matching the caption again.
    this.#responseItemId = undefined;
    // And forgetting its response is what stops its finished form — cancelled
    // or not, the server may already have completed it — from being read as
    // the current turn's: a `response.done` that matches nothing can neither
    // act with the new turn's arming nor end the new turn early.
    this.#activeResponseId = undefined;
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#clearSettleTimer();
  }

  /**
   * Voices a proactive update that the attention layer already approved,
   * reporting whether it could. A refusal is not a loss: the caller shows the
   * sentence instead, which is the same thing it does when voice is off. That
   * is better than holding it — the attention layer supersedes its own
   * decisions, so a sentence saved for later is a sentence likely to be stale.
   */
  speak(speech: AttentionSpeech): boolean {
    const events = proactiveSpeechEvents(speech);
    if (events.length === 0 || !this.isConnected || this.#turnBusy) return false;
    this.#startResponse(events);
    return true;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#teardown();
    this.#setStatus(REALTIME_STATUS.IDLE);
  }

  /**
   * Releases the microphone and the peer connection without deciding what the
   * session's status becomes. Every path that stops the call goes through here,
   * so a failure can never leave the macOS microphone indicator lit with no way
   * to turn it off.
   */
  #teardown(): void {
    const channel = this.#channel;
    if (channel) {
      // Detach before closing. `close()` fires `onclose` asynchronously, and
      // letting that handler run would tear down a second time and force the
      // status to idle — overwriting the `failed` the caller is about to set,
      // so a refused call would surface as "Voice off".
      channel.onclose = null;
      channel.onmessage = null;
      channel.close();
    }
    this.#channel = undefined;
    const peer = this.#peer;
    if (peer) {
      // Detach for the same reason the channel does. `close()` drives the
      // connection to `closed`, and this handler treats that as fatal.
      peer.onconnectionstatechange = null;
      peer.ontrack = null;
      peer.close();
    }
    this.#peer = undefined;
    this.#remoteTrack = undefined;
    this.#microphone = undefined;
    this.#stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.#stream = undefined;
    this.#sessionContext = undefined;
    this.#sessions = [];
    this.#guide = EMPTY_APP_GUIDE;
    this.#guideContext = undefined;
    this.#workspaceProjects = [];
    this.#workspaceProjectContext = undefined;
    this.#issues = undefined;
    this.#issueContext = undefined;
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#pendingTurn = false;
    // The next call is minted at the stored pace, so nothing is owed to it.
    this.#pendingSpeed = undefined;
    this.#responseItemId = undefined;
    this.#activeResponseId = undefined;
    this.#audibleSince = undefined;
    this.#setCaption(undefined);
    // Learned about this call, so it does not outlive it.
    this.#audioEndingsReported = false;
    this.#clearSettleTimer();
    this.#options.onLocalStream(undefined);
    this.#options.onRemoteStream(undefined);
  }

  #startResponse(events: readonly Record<string, unknown>[], toolsArmed = false): void {
    // A pace still waiting from the last reply lands here, ahead of the
    // request: the channel is ordered and no response is in progress — a
    // cancel for the reply being talked over was sent before this — so the
    // reply about to be asked for is already spoken at the new pace.
    this.#flushPendingSpeed();
    // The track is deliberately left as it is. A reply that was cut off left it
    // disabled, and re-opening it here would let the tail of that reply — still
    // arriving, because the server sent it before it was told to stop — be
    // heard as the answer to what was just said. It is opened again when the
    // server confirms the new reply has started, by which point the old one is
    // certainly over: the data channel is ordered, so the clear that ended it
    // was handled before the request for this one.
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#responseItemId = undefined;
    // Nothing has been confirmed for this turn yet: whatever `response.done`
    // arrives before the server confirms this reply belongs to a superseded
    // one, and must find no active response to match.
    this.#activeResponseId = undefined;
    this.#audibleSince = undefined;
    // A new turn: only a developer-opened one may run a tool, and any tool
    // follow-up still awaiting from the last turn will see this and stand down.
    this.#toolTurnArmed = toolsArmed;
    this.#turnEpoch += 1;
    this.#setCaption(undefined);
    this.#clearSettleTimer();
    this.#send(events);
    this.#setStatus(REALTIME_STATUS.RESPONDING);
  }

  /**
   * Reports that Luke's audio has gone quiet. Called from wherever the remote
   * stream is already being measured, so nothing has to analyse it twice.
   *
   * Whether a stretch of quiet is Luke's to answer for is decided by
   * {@link quietIsLukesOwn} before this is called at all.
   */
  reportRemoteAudioIdle(): void {
    // Remembered rather than acted on and forgotten: if generation has not
    // finished yet, this is still the only quiet edge the meter will report,
    // and `response.done` is what will read it.
    this.#remoteQuiet = true;
    // Nothing to infer on a call that reports its own endings. Inferring here
    // is what ended a reply in the pause between its two sentences.
    if (this.#audioEndingsReported) return;
    if (!this.#generationDone) return;
    this.#finishResponse();
  }

  /**
   * Reports that Luke is audible again. A pause between two sentences is longer
   * than the meter's idea of quiet, so without this a reply that pauses and
   * resumes would end on the pause the moment generation finished — with Luke
   * still speaking.
   */
  reportRemoteAudioActive(): void {
    this.#remoteQuiet = false;
    // The first time this reply is heard is the clock a truncate measures
    // against. Later edges are pauses within it, not new beginnings.
    this.#audibleSince ??= this.#now();
  }

  /**
   * What to trim the cut-off reply to, if there is anything to trim. Nothing
   * heard means nothing to correct — a reply interrupted in the gap before its
   * first word left no impression to undo.
   */
  #truncateEvents(): readonly Record<string, unknown>[] {
    const itemId = this.#responseItemId;
    const audibleSince = this.#audibleSince;
    if (!itemId || audibleSince === undefined) return [];
    return truncateResponseEvents({ itemId, audioEndMs: this.#now() - audibleSince });
  }

  #now(): number {
    return this.#options.now?.() ?? performance.now();
  }

  #silenceLuke(): void {
    if (this.#remoteTrack) this.#remoteTrack.enabled = false;
  }

  #unsilenceLuke(): void {
    if (this.#remoteTrack) this.#remoteTrack.enabled = true;
  }

  #clearSettleTimer(): void {
    if (this.#settleTimer === undefined) return;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = undefined;
  }

  #setCaption(text: string | undefined): void {
    if (this.#caption === text) return;
    this.#caption = text;
    this.#options.onCaption(text);
  }

  /** Ends the turn once the reply is done, so the next one can start. */
  #finishResponse(): void {
    this.#generationDone = false;
    // The caption is of speech, and the speech is over. Whatever ended the
    // reply — the audio draining, an error, the settle timer — the words leave
    // with the meter and the face rather than lingering under a quiet capsule.
    this.#setCaption(undefined);
    // Whatever ended the reply — an error, the settle timer, Luke simply
    // stopping — the next one has to be audible. Without this a reply that
    // failed before it started would leave Luke silenced with nothing to
    // un-silence him.
    this.#unsilenceLuke();
    this.#clearSettleTimer();
    // The reply is over, so the API is between turns — the one moment it
    // accepts a pace change that arrived while Luke was speaking.
    this.#flushPendingSpeed();
    if (this.#status === REALTIME_STATUS.RESPONDING) this.#setStatus(REALTIME_STATUS.READY);
  }

  /**
   * Changes how fast Luke speaks on the call now open, from his next reply on.
   * A call minted at one pace stays a live session, so the change travels as a
   * session update rather than waiting for the next conversation. The API
   * applies a pace only between model turns: a change landing mid-reply is
   * held and sent when the reply ends. With no call open there is nothing to
   * update — the next one is minted at the stored pace already.
   */
  applySpeed(speed: number): void {
    if (!this.isConnected) return;
    if (this.#status === REALTIME_STATUS.RESPONDING) {
      this.#pendingSpeed = speed;
      return;
    }
    this.#pendingSpeed = undefined;
    this.#send(outputSpeedUpdateEvents(speed));
  }

  /** Sends the pace change that waited out a reply, once nothing is speaking. */
  #flushPendingSpeed(): void {
    const speed = this.#pendingSpeed;
    if (speed === undefined) return;
    this.#pendingSpeed = undefined;
    this.#send(outputSpeedUpdateEvents(speed));
  }

  /**
   * Tells the conversation what Luke can currently see.
   *
   * The standing instructions describe session state as something Luke knows,
   * so without this the prompt would assert a capability the connection never
   * provides and a question about live work could not be answered from real
   * data. Identical rosters are not resent.
   */
  updateSessions(sessions: readonly NormalizedSession[]): void {
    this.#sessions = sessions;
    if (!this.isConnected) return;
    const context = sessionContextText(sessions);
    if (context === this.#sessionContext) return;
    this.#sessionContext = context;
    this.#send(sessionContextEvents(sessions));
  }

  /**
   * Tells the conversation where a workspace can be created, the same way the
   * roster travels: context that must never open Luke's mouth, kept whole
   * because it is what a spoken creation ask is validated against. Identical
   * lists are not resent.
   */
  updateWorkspaceProjects(projects: readonly ObservedWorkspaceProject[]): void {
    this.#workspaceProjects = projects;
    if (!this.isConnected) return;
    const context = workspaceProjectContextText(projects);
    if (context === this.#workspaceProjectContext) return;
    this.#workspaceProjectContext = context;
    this.#send(workspaceProjectContextEvents(projects));
  }

  /**
   * Tells the conversation what Luke currently knows about himself, the same
   * way the roster does: the standing instructions promise an app guide, so
   * one has to arrive before a question about Luke can be answered from real
   * state. Identical guides are not resent, and the snapshot is kept whole for
   * validating the spoken asks it advertises.
   */
  updateGuide(guide: AppGuideSnapshot): void {
    this.#guide = guide;
    if (!this.isConnected) return;
    const context = appGuideContextText(guide);
    if (context === this.#guideContext) return;
    this.#guideContext = context;
    this.#send(appGuideContextEvents(guide));
  }

  /**
   * Tells the conversation what the issue tracker lists, under the same rule
   * the session roster follows: identical rosters are not resent, and no
   * tracker connected means no roster at all — the absence is itself what
   * lets Luke say a tracker is not connected rather than inventing a board.
   */
  updateIssues(issues: readonly TrackedIssue[] | undefined): void {
    this.#issues = issues;
    if (!this.isConnected) return;
    if (!issues) {
      // A conversation that was never told about a board has nothing to
      // withdraw; one that was must be told the board is gone, or Luke keeps
      // answering from a tracker nobody is observing.
      if (this.#issueContext === undefined) return;
      this.#issueContext = undefined;
      this.#send(issueTrackerDisconnectedEvents());
      return;
    }
    const context = issueContextText(issues);
    if (context === this.#issueContext) return;
    this.#issueContext = context;
    this.#send(issueContextEvents(issues));
  }

  #handleServerEvent(data: unknown): void {
    if (typeof data !== "string") return;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    if (event === null || typeof event !== "object") return;
    const type = (event as { type?: unknown }).type;
    if (type === REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED) {
      const item = (event as { item?: { id?: unknown } }).item;
      if (typeof item?.id === "string") this.#responseItemId = item.id;
    }
    if (type === REALTIME_SERVER_EVENT.RESPONSE_CREATED) {
      // The reply being asked for is under way, so anything arriving from here
      // belongs to it rather than to the one it replaced. Its name is what a
      // `response.done` must present to be read as this reply's: the channel
      // is ordered, so a cancelled reply's `done` lands before this
      // confirmation and finds nothing to match.
      const response = (event as { response?: { id?: unknown } }).response;
      if (typeof response?.id === "string") this.#activeResponseId = response.id;
      this.#unsilenceLuke();
    }
    if (type === REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA) {
      const { delta, item_id } = event as { delta?: unknown; item_id?: unknown };
      // Only the reply being spoken may write the caption. A cancelled reply's
      // transcript keeps arriving after the interrupt that cleared it — the
      // server had already produced it — and without this check a late piece
      // would draw the words Luke was just stopped from saying, or splice them
      // onto the next reply's.
      if (item_id === this.#responseItemId && typeof delta === "string" && delta) {
        this.#setCaption((this.#caption ?? "") + delta);
      }
    }
    if (type === REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE) {
      // The server's own rendering of the whole reply, which the deltas only
      // approximate: a delta lost to the channel would otherwise leave a hole
      // in the sentence for as long as it stayed up. Held to the same item as
      // the deltas, because the cancelled reply's `done` is the likeliest
      // straggler of all.
      const { transcript, item_id } = event as { transcript?: unknown; item_id?: unknown };
      if (item_id === this.#responseItemId && typeof transcript === "string" && transcript) {
        this.#setCaption(transcript);
      }
    }
    if (type === REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED) {
      this.#audioEndingsReported = true;
      // The reply is over because the server says the audio ran out, not
      // because this end guessed from a stretch of quiet. A pause between two
      // sentences is quiet too, and guessing ended the turn in the middle of
      // one — the meter and the face went with it while Luke talked on.
      this.#finishResponse();
      return;
    }
    if (type === REALTIME_SERVER_EVENT.RESPONSE_DONE) {
      // Whether this is the reply now under way, or the finished form of one
      // the developer already talked or typed over. The server had completed
      // the old reply before the cancel landed — it generates ahead of the
      // room — so its `done` still arrives, after the interrupt has already
      // opened a new turn. Nothing of it may act with that turn's arming or
      // end that turn early: its calls are answered refused so the model is
      // not left waiting, and everything else about it is ignored.
      const doneId = (event as { response?: { id?: unknown } }).response?.id;
      const fresh = (typeof doneId === "string" ? doneId : undefined) === this.#activeResponseId;
      // A reply that asked for tools has not finished talking: the calls are
      // answered and the reply resumes over their outcomes, so the turn stays
      // open rather than ending on a reply that was only half made.
      const calls = realtimeFunctionCalls(event);
      if (calls.length > 0) {
        void this.#answerToolCalls(calls, fresh && this.#toolTurnArmed);
        return;
      }
      if (!fresh) return;
      // Generation is done; the reply is not. The turn ends when Luke stops
      // being audible, which the caller reports from the audio itself rather
      // than from an event — the one that would say so is undocumented.
      this.#generationDone = true;
      // The audio can run out before the event that says generation is over.
      // The meter has already reported its quiet and will not report it twice,
      // so waiting for another would hold the turn open until the settle
      // timeout — seconds of a meter and a face saying Luke is still talking.
      if (this.#remoteQuiet && !this.#audioEndingsReported) {
        this.#finishResponse();
        return;
      }
      this.#settleTimer ??= setTimeout(() => {
        this.#settleTimer = undefined;
        this.#finishResponse();
      }, REALTIME_SETTLE_TIMEOUT_MS);
    }
    if (type === REALTIME_SERVER_EVENT.ERROR) {
      const message = (event as { error?: { message?: unknown } }).error?.message;
      this.#options.onError(
        typeof message === "string" ? message : "The voice service reported an error.",
      );
      // An error can arrive *instead of* `response.done` — an empty push-to-talk
      // commit is the common case — which would otherwise leave the session
      // stuck in `responding` and unable to take another turn.
      this.#finishResponse();
    }
  }

  /**
   * Answers the tool calls one reply made, then asks for the reply that voices
   * their outcomes. Every call is validated against the roster Luke was shown
   * before anything is carried, every outcome — including each refusal — is
   * answered so the model never waits on a call that will not return, and the
   * carrier's own failure is an outcome rather than an exception: the developer
   * asked for something, and what became of it has to be said.
   */
  async #answerToolCalls(calls: readonly RealtimeFunctionCall[], armed: boolean): Promise<void> {
    // `armed` is the hard gate, decided by the caller from two facts together:
    // a write runs only in a turn the developer opened — by speaking, or by
    // typing — and only out of the reply that turn actually asked for, never
    // the finished form of one the developer already interrupted. A call
    // failing either test is refused whatever it names, so a session summary
    // or a tool output that reads like an instruction can never make Luke act.
    // The turn's tools are also withheld at the API on every turn Luke opens
    // himself, so this is belt to that suspenders rather than the only thing
    // holding.
    // The turn these calls belong to. If it is no longer the current turn by
    // the time the writes finish, the developer has moved on and the outcome
    // must not be spoken over whatever they are now saying or hearing.
    const epoch = this.#turnEpoch;

    for (const call of calls) {
      const output = await this.#toolCallOutput(call, armed);
      this.#send(functionCallOutputEvents(call.callId, output));
    }

    // An unarmed turn — a proactive readout, a follow-up — carries no outcome
    // to voice: every call on it was refused, and opening a reply here would be
    // a turn that was meant to stay silent talking on without its instructions.
    // The calls are still answered above, so the model is not left waiting.
    if (!armed) return;
    // A follow-up now would talk over a live microphone or a newer reply: the
    // developer took the turn, started another, or the call is gone. The
    // outcomes were still delivered as items, so the next turn has them.
    if (!this.isConnected || this.#turnEpoch !== epoch) return;
    this.#startResponse(functionCallFollowUpEvents());
  }

  async #toolCallOutput(
    call: RealtimeFunctionCall,
    armed: boolean,
  ): Promise<Record<string, unknown>> {
    if (!armed) {
      return {
        status: "refused",
        reason: "Only a request you make yourself can act on a session or an issue.",
      };
    }
    // An ask about Luke himself is validated against the guide the app
    // actually provided, then carried by the renderer the same way a session
    // act is: perform, and answer with what became of it.
    if (isAppToolCall(call)) {
      const appAction = appToolAction(call, this.#guide, this.#sessions);
      if (appAction.kind === "refused") return { status: "refused", reason: appAction.reason };
      if (!this.#options.carryAppAction) {
        return { status: "refused", reason: "Acting on Luke's own settings is not available." };
      }
      try {
        return await this.#options.carryAppAction(appAction);
      } catch {
        return { status: "refused", reason: "The change could not be made." };
      }
    }
    if (isIssueToolName(call.name)) return this.#issueToolCallOutput(call);
    if (!isSessionToolName(call.name)) {
      return { status: "refused", reason: "No such tool exists." };
    }
    const action = sessionToolAction(call, this.#sessions, this.#workspaceProjects);
    if (action.kind === "refused") return { status: "refused", reason: action.reason };
    if (!this.#options.carryAction) {
      return { status: "refused", reason: "Acting on sessions is not available." };
    }
    try {
      return await this.#options.carryAction(action);
    } catch {
      return { status: "refused", reason: "The action could not be carried out." };
    }
  }

  async #issueToolCallOutput(call: RealtimeFunctionCall): Promise<Record<string, unknown>> {
    // No roster was ever sent, so there is nothing a call could have named.
    if (!this.#issues) {
      return { status: "refused", reason: "No issue tracker is connected." };
    }
    const action = issueToolAction(call, this.#issues);
    if (action.kind === "refused") return { status: "refused", reason: action.reason };
    if (!this.#options.carryIssueAction) {
      return { status: "refused", reason: "Acting on issues is not available." };
    }
    try {
      return await this.#options.carryIssueAction(action);
    } catch {
      return { status: "refused", reason: "The action could not be carried out." };
    }
  }

  #send(events: readonly Record<string, unknown>[]): void {
    const channel = this.#channel;
    if (channel?.readyState !== "open") return;
    for (const event of events) channel.send(JSON.stringify(event));
  }

  #fail(message: string): boolean {
    // Release the device before reporting. `FAILED` offers "Start voice" again,
    // and retrying must not stack a second call on top of a live microphone.
    this.#teardown();
    this.#options.onError(message);
    this.#setStatus(REALTIME_STATUS.FAILED);
    return false;
  }

  #setStatus(status: RealtimeStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.onStatus(status);
  }
}
