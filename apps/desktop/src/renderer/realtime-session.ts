import {
  type AttentionSpeech,
  cancelResponseEvents,
  clearInputAudioEvents,
  type NormalizedSession,
  proactiveSpeechEvents,
  pushToTalkCommitEvents,
  REALTIME_DATA_CHANNEL,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeConnection,
  type RealtimeStatus,
  sessionContextEvents,
  sessionContextText,
  truncateResponseEvents,
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

export interface RealtimeVoiceSessionCallbacks {
  onStatus(status: RealtimeStatus): void;
  onLocalStream(stream: MediaStream | undefined): void;
  onRemoteStream(stream: MediaStream | undefined): void;
  onError(message: string | undefined): void;
}

export interface RealtimeVoiceSessionOptions extends RealtimeVoiceSessionCallbacks {
  requestConnection(): Promise<RealtimeConnection | undefined>;
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
  #audibleSince: number | undefined;
  /**
   * Whether this call has ever reported a reply's audio running out. Once it
   * has, silence stops being evidence of anything: the server says when Luke is
   * finished, and a stretch of quiet is just as likely to be the gap between
   * two sentences. Calls that never report one keep the old guess, because a
   * turn that never ends is worse than one that ends early.
   */
  #audioEndingsReported = false;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;

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

    let connection: RealtimeConnection | undefined;
    try {
      connection = await this.#options.requestConnection();
    } catch (error) {
      // A stop that lands while the credential is being minted is not a fault
      // to report. Every exit from here has to ask, not just the ones after the
      // device exists.
      if (this.#closed) return this.#abandonConnect();
      return this.#fail(`Could not reach the main process: ${errorMessage(error)}`);
    }
    if (this.#closed) return this.#abandonConnect();
    if (!connection) {
      this.#setStatus(REALTIME_STATUS.UNAVAILABLE);
      return false;
    }

    try {
      const stream = await (this.#options.requestMicrophoneStream?.() ??
        navigator.mediaDevices.getUserMedia({
          audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
          video: false,
        }));
      this.#stream = stream;
      const [microphone] = stream.getAudioTracks();
      if (!microphone) throw new Error("No microphone track was available");
      // Push-to-talk starts closed. Nothing is sent until the developer asks.
      microphone.enabled = false;
      this.#microphone = microphone;
      this.#options.onLocalStream(stream);
      // `close()` can land while this is still awaiting. The device now exists,
      // so bailing out without releasing it would leave the microphone held by
      // a session the caller already stopped.
      if (this.#closed) return this.#abandonConnect();

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
    if (this.#status === REALTIME_STATUS.RESPONDING) {
      // Stop the words that are already on their way, then stop more being
      // made. A disabled track drops what is buffered rather than playing it
      // out, so the cut-off is immediate rather than eventual.
      this.#silenceLuke();
      this.#send(cancelResponseEvents());
      // Then correct what Luke believes he said, or the next answer is free to
      // refer back to a sentence that never reached the room.
      this.#send(this.#truncateEvents());
      this.#generationDone = false;
      this.#remoteQuiet = false;
      this.#clearSettleTimer();
    }
    // Start from an empty buffer: a muted track still transmits, and with turn
    // detection off the server keeps everything since the last commit.
    this.#send(clearInputAudioEvents());
    this.#microphone.enabled = true;
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
    this.#startResponse(pushToTalkCommitEvents());
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
    this.#generationDone = false;
    this.#remoteQuiet = false;
    this.#pendingTurn = false;
    this.#responseItemId = undefined;
    this.#audibleSince = undefined;
    // Learned about this call, so it does not outlive it.
    this.#audioEndingsReported = false;
    this.#clearSettleTimer();
    this.#options.onLocalStream(undefined);
    this.#options.onRemoteStream(undefined);
  }

  #startResponse(events: readonly Record<string, unknown>[]): void {
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
    this.#audibleSince = undefined;
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

  /** Ends the turn once the reply is done, so the next one can start. */
  #finishResponse(): void {
    this.#generationDone = false;
    // Whatever ended the reply — an error, the settle timer, Luke simply
    // stopping — the next one has to be audible. Without this a reply that
    // failed before it started would leave Luke silenced with nothing to
    // un-silence him.
    this.#unsilenceLuke();
    this.#clearSettleTimer();
    if (this.#status === REALTIME_STATUS.RESPONDING) this.#setStatus(REALTIME_STATUS.READY);
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
    if (!this.isConnected) return;
    const context = sessionContextText(sessions);
    if (context === this.#sessionContext) return;
    this.#sessionContext = context;
    this.#send(sessionContextEvents(sessions));
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
      // belongs to it rather than to the one it replaced.
      this.#unsilenceLuke();
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
