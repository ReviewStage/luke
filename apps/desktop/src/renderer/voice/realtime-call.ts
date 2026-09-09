import { TRACE_DIRECTION, type TraceDirection } from "@sidecar/devtrace/vocabulary";
import type { RealtimeConnection } from "@sidecar/hosted";
import {
  decodeRealtimePayload,
  parseRealtimeServerEvent,
  REALTIME_STATUS,
  type RealtimeStatus,
} from "@sidecar/realtime";
import { positiveInteger, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import {
  type BuiltRealtimeSessionConfig,
  createAgentsRealtimeTransport,
  type SdkRealtimeTransport,
  type SdkToolCallDetails,
  type SdkTransportFactory,
} from "./agents-realtime-transport";
import type { RealtimeServerEventHandlers } from "./realtime-server-events";

/** Bounds the SDK's WebRTC handshake and initial session acknowledgement. */
const CONNECT_TIMEOUT_MS = 15_000;

export interface RealtimeCallOptions {
  onStatus(status: RealtimeStatus): void;
  onRemoteStream(stream: MediaStream | undefined): void;
  onError(message: string | undefined): void;
  /**
   * A development tap on the wire itself: every event this call sends and
   * every event the service answers, as they cross the data channel. The tap
   * observes and never steers — nothing here reads its result — and the
   * caller decides per event whether anything leaves it, because the call
   * outlives the bootstrap that says whether a trace is being written.
   */
  onWireEvent?: (direction: TraceDirection, event: WireRecord) => void;
  requestConnection(): Promise<RealtimeConnection | undefined>;
  /** The SDK call seam, injectable so the complete transport can be tested without WebRTC. */
  createSdkTransport?: SdkTransportFactory;
  /** The existing hidden playback element owned by the renderer. */
  audioElement?: () => HTMLAudioElement | null;
  connectTimeoutMs?: number;
  /** Injectable so a test can hold the clock a truncate measures against. */
  now?: () => number;
}

/** Traps a teardown step's failure so the steps after it still run. */
export type TeardownStep = (action: () => void) => void;

/**
 * One Realtime call's transport: the handshake, the peer connection, the
 * status ladder, the wire tap, and the teardown every failure path goes
 * through. It knows nothing of turns, captions, or tools — what kind of call
 * this is, the session document it is configured with, and whether it can
 * answer a tool at all are the subclass's, which is what lets a call that
 * opens no capture device be a type rather than a flag.
 */
export abstract class RealtimeCall<Options extends RealtimeCallOptions = RealtimeCallOptions> {
  protected readonly options: Options;
  #sdkTransport: SdkRealtimeTransport | undefined;
  #tearingDown = false;
  #status: RealtimeStatus = REALTIME_STATUS.IDLE;
  #connecting: Promise<boolean> | undefined;
  #closed = false;
  /**
   * Luke's own audio track. Cancelling stops the model producing more, but what
   * it already produced is on its way down the connection and keeps playing —
   * so cutting him off means silencing this end too, which is the only half of
   * it entirely under our control.
   */
  #remoteTrack: MediaStreamTrack | undefined;
  /**
   * The connect attempt the state below belongs to, as an identity: refreshed
   * by every teardown, captured by a device open before its wait, and what a
   * device arriving late is checked against — a call closed or replaced while
   * the device was opening keeps a fresh token, so the stale open releases
   * what it holds instead of adopting it. Mid-connect there is no sender yet
   * to stand for the call, so the token is what does.
   */
  #attempt = Symbol("connect-attempt");
  #handlers: RealtimeServerEventHandlers | undefined;

  constructor(options: Options) {
    this.options = options;
  }

  /**
   * Whether the call that is up — or coming up — is one the developer can take
   * a turn on. False on a speak-only call by construction: it has no capture
   * device to offer, which is how a talk-key press knows it still has a call
   * of its own to open.
   */
  abstract get microphoneCall(): boolean;

  /** The session document this kind of call is configured with. */
  protected abstract sessionConfig(model: string): BuiltRealtimeSessionConfig;

  /**
   * The SDK's tool bridge. A speak-only call declares no tools and refuses
   * every call; the developer's conversation answers its one.
   */
  protected abstract executeTool(
    name: string,
    details: SdkToolCallDetails | undefined,
  ): Promise<WireRecord>;

  /**
   * The server events this kind of call acts on, as one handler each. Built
   * once per call: the handlers close over `this` and never change, and a
   * table rebuilt per event would allocate one on every frame of speech.
   */
  protected abstract handlers(): RealtimeServerEventHandlers;

  /** Runs once the channel is open and the call has reported itself ready. */
  protected onChannelOpen(): void {}

  /** Runs inside the teardown, before the transport's own state is cleared. */
  protected onTeardown(_step: TeardownStep): void {}

  /** Runs on every decoded record, before the parser narrows it. */
  protected onRawRecord(_record: WireRecord): void {}

  /** Runs when a connect ends with no call, so no intention outlives it. */
  protected onConnectFailed(): void {}

  /** Runs when the call is lost rather than put away: a drop, or a failure. */
  protected onCallLost(): void {}

  /** Runs on every status edge, before the caller is told of it. */
  protected onStatusChanged(_status: RealtimeStatus): void {}

  /** The SDK reporting that a tool's output reached the wire. */
  protected onToolOutputSent(_callId: string): void {}

  /**
   * Adopts the negotiated peer connection: Luke's own track, and the failure
   * a dropped connection reports. A call with a sending half of its own
   * overrides this to claim the sender the silent track rides.
   */
  protected onPeerConnection(peer: RTCPeerConnection, _silenceTrack: MediaStreamTrack): void {
    const sdkOnTrack = peer.ontrack;
    peer.ontrack = (event) => {
      sdkOnTrack?.call(peer, event);
      this.#remoteTrack = event.track;
      this.options.onRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
    };
    // The listener outlives the peer it was added to, so a stale peer's late
    // `failed` is answered by the attempt token rather than by the live call.
    const attempt = this.#attempt;
    peer.addEventListener("connectionstatechange", () => {
      if (attempt !== this.#attempt || this.#closed) return;
      if (peer.connectionState === "failed") this.fail("The voice connection dropped.");
    });
  }

  get status(): RealtimeStatus {
    return this.#status;
  }

  get isConnected(): boolean {
    return this.#sdkTransport?.status === "connected";
  }

  /** Whether a call is being opened, so a press has something to wait for. */
  get isConnecting(): boolean {
    return this.#connecting !== undefined;
  }

  /** Whether this call has been put away and must adopt nothing more. */
  protected get closed(): boolean {
    return this.#closed;
  }

  /** The identity of the connect attempt now standing. */
  protected get attempt(): symbol {
    return this.#attempt;
  }

  /**
   * Opens the call, reusing an in-flight attempt rather than racing a second
   * one.
   */
  async connect(): Promise<boolean> {
    // Wait out whatever attempt is already in flight rather than racing it.
    // A loop, because another caller can start a new attempt in the gap.
    while (this.#connecting) await this.#connecting;
    if (this.isConnected) return true;
    this.#connecting = this.#connect()
      .then((opened) => {
        // A press does not outlive the attempt it started. Every way a connect
        // ends without a call passes through here — no credential, a refused
        // call, a timeout — so none of them can leave an intention behind for
        // some later connection to open a turn nobody asked for.
        if (!opened) this.onConnectFailed();
        return opened;
      })
      .finally(() => {
        this.#connecting = undefined;
      });
    return this.#connecting;
  }

  async #connect(): Promise<boolean> {
    this.#closed = false;
    this.setStatus(REALTIME_STATUS.CONNECTING);
    this.options.onError(undefined);

    // Connecting opens no capture device of its own: the microphone is the
    // developer's, not the call's, and it opens only when a press takes a
    // turn. A press that started this connect has already asked for it, and
    // its capture rides beside the mint — but that is the press's doing,
    // never the connect's.
    let connection: RealtimeConnection | undefined;
    try {
      connection = await this.options.requestConnection();
    } catch (error) {
      // A stop that lands while the credential is being minted is not a fault
      // to report. Every exit from here has to ask, not just the ones after
      // the handshake starts.
      if (this.#closed) return this.#abandonConnect();
      if (!(error instanceof Error)) return this.fail(String(error));
      return this.fail(`Could not reach the main process: ${error.message}`);
    }
    if (this.#closed) return this.#abandonConnect();
    if (!connection) {
      this.teardown();
      this.setStatus(REALTIME_STATUS.UNAVAILABLE);
      return false;
    }

    try {
      const factory = this.options.createSdkTransport ?? createAgentsRealtimeTransport;
      const sdkTransport = factory({
        sessionConfig: this.sessionConfig(connection.model),
        audioElement: this.options.audioElement?.() ?? undefined,
        onPeerConnection: (peer, silenceTrack) => this.onPeerConnection(peer, silenceTrack),
        onTransportEvent: (event) => this.#receive(event),
        onClientEvent: (event) => this.options.onWireEvent?.(TRACE_DIRECTION.CLIENT, event),
        onToolOutputSent: (callId) => this.onToolOutputSent(callId),
        onConnectionChange: (status) => this.#connectionChanged(status),
        onError: (message) => this.options.onError(message),
        executeTool: (name, details) => this.executeTool(name, details),
      });
      this.#sdkTransport = sdkTransport;
      const timeoutMs = positiveInteger(this.options.connectTimeoutMs, CONNECT_TIMEOUT_MS);
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          reject(new Error("The voice connection timed out while opening."));
        }, timeoutMs);
      });
      try {
        await Promise.race([
          sdkTransport.connect({
            apiKey: connection.value,
            model: connection.model,
            url: connection.callsUrl,
          }),
          deadline,
        ]);
      } finally {
        if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      }
      if (this.#closed) return this.#abandonConnect();
      this.setStatus(REALTIME_STATUS.READY);
      this.onChannelOpen();
      return true;
    } catch (error) {
      if (this.#closed) return this.#abandonConnect();
      if (!(error instanceof Error)) return this.fail(String(error));
      return this.fail(error.message);
    }
  }

  /**
   * Releases everything a cancelled connect had already acquired, leaving the
   * call idle as the caller that stopped it intended.
   */
  #abandonConnect(): boolean {
    this.teardown();
    this.setStatus(REALTIME_STATUS.IDLE);
    return false;
  }

  #connectionChanged(status: SdkRealtimeTransport["status"]): void {
    // Teardown clears the transport before anything can report on it, so a
    // `disconnected` with no transport standing is a call already ended — by
    // a stop or a failure whose status must not be rewritten to idle.
    if (
      status !== "disconnected" ||
      this.#closed ||
      this.#tearingDown ||
      !this.#sdkTransport ||
      this.#status === REALTIME_STATUS.CONNECTING
    ) {
      return;
    }
    this.onCallLost();
    this.teardown();
    this.setStatus(REALTIME_STATUS.IDLE);
  }

  #receive(data: UnparsedWireValue): void {
    // Decoded once, here: the tap reads the record whole — the parser below
    // keeps only the events the conversation acts on, and what it discards
    // (usage, errors in full, event types this build does not know) is half
    // of what a trace exists to show — and the parser accepts the decoded
    // record as readily as the string, so nothing is parsed twice.
    const record = decodeRealtimePayload(data);
    if (record) {
      this.options.onWireEvent?.(TRACE_DIRECTION.SERVER, record);
      this.onRawRecord(record);
    }
    const event = parseRealtimeServerEvent(record);
    if (!event) return;
    this.#handlers ??= this.handlers();
    const handler = this.#handlers[event.type];
    // SAFETY: the table is keyed by event type, so the handler found under
    // this event's own type is the one narrowed to it.
    (handler as ((narrowed: typeof event) => void) | undefined)?.(event);
  }

  async close(): Promise<void> {
    this.clearConversation();
  }

  /**
   * Retires the call that owns the current conversation. Realtime items cannot
   * be enumerated and deleted reliably, so Clear crosses a call boundary: the
   * next developer turn receives a fresh server-side conversation as well as
   * the caller's freshly emptied local history.
   */
  clearConversation(): void {
    this.#closed = true;
    this.teardown();
    this.setStatus(REALTIME_STATUS.IDLE);
  }

  /**
   * Releases the peer connection and everything the subclasses hold, without
   * deciding what the call's status becomes. Every path that stops the call
   * goes through here, so a failure can never leave the macOS microphone
   * indicator lit with no way to turn it off.
   */
  protected teardown(): void {
    if (this.#tearingDown) return;
    this.#tearingDown = true;
    let teardownError: unknown;
    const step: TeardownStep = (action) => {
      try {
        action();
      } catch (error) {
        teardownError ??= error;
      }
    };
    const transport = this.#sdkTransport;
    this.#sdkTransport = undefined;
    step(() => transport?.close());
    this.#remoteTrack = undefined;
    // A fresh token before anything the subclasses hold retires: a device
    // still opening for the attempt this teardown ends finds it stale and
    // releases itself.
    this.#attempt = Symbol("connect-attempt");
    step(() => this.onTeardown(step));
    step(() => this.options.onRemoteStream(undefined));
    this.#tearingDown = false;
    if (teardownError !== undefined) {
      try {
        this.options.onError(
          teardownError instanceof Error ? teardownError.message : String(teardownError),
        );
      } catch {
        // Teardown has already completed; an error reporter cannot undo it.
      }
    }
  }

  protected send(events: readonly WireRecord[]): void {
    const transport = this.#sdkTransport;
    if (transport?.status !== "connected") return;
    for (const event of events) transport.sendEvent(event);
  }

  protected fail(message: string): boolean {
    // Release the device before reporting. `FAILED` offers "Start voice" again,
    // and retrying must not stack a second call on top of a live microphone.
    this.onCallLost();
    this.teardown();
    this.options.onError(message);
    this.setStatus(REALTIME_STATUS.FAILED);
    return false;
  }

  protected setStatus(status: RealtimeStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.onStatusChanged(status);
    this.options.onStatus(status);
  }

  protected now(): number {
    return this.options.now?.() ?? performance.now();
  }

  protected silenceLuke(): void {
    if (this.#remoteTrack) this.#remoteTrack.enabled = false;
  }

  protected unsilenceLuke(): void {
    if (this.#remoteTrack) this.#remoteTrack.enabled = true;
  }
}
