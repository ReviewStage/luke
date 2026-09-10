import { TRACE_DIRECTION, type TraceDirection } from "@sidecar/devtrace/vocabulary";
import {
  LIVE_TRANSPORT_STATE,
  type LiveTransportState,
  voiceReportLiveTransportParamsSchema,
} from "@sidecar/gateway";
import {
  closeEvent,
  decodeLivePayload,
  LIVE_IDLE_WINDOW_MS,
  LIVE_SERVER_EVENT,
  LIVE_STATUS,
  type LiveClientEvent,
  type LiveServerEvent,
  type LiveStatus,
  muteEvent,
  parseLiveServerEvent,
  TRANSCRIPT_SPEAKER,
  unmuteEvent,
} from "@sidecar/live";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import type {
  LiveCaptionRow,
  LiveVoiceCall,
  LiveVoiceCallEvents,
} from "@sidecar/voice/orchestrator";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { LiveCaptions } from "./live-captions";
import {
  LIVE_PEER_OUTCOME,
  type LivePeer,
  type LivePeerConnection,
  openLivePeer,
  teardown,
} from "./live-peer";

/** How long a created session may take to announce itself started before the peer gives up on it. */
export const SESSION_START_TIMEOUT_MS = 15_000;

/** The conversations guide's bound on a graceful close: `session.closed` awaited this long after `session.close`. */
export const SESSION_CLOSE_TIMEOUT_MS = 15_000;

/** How long an acknowledgment of the microphone switch is waited for before the ask is given up. */
export const MICROPHONE_ACK_TIMEOUT_MS = 5_000;

/**
 * How long after Luke's track goes quiet he still counts as speaking, so a
 * pause between two of his sentences is not an exchange ending: the media
 * duck would let the music up and the exchange would be counted again on the
 * next word.
 */
export const SPEAKING_HANGOVER_MS = 1_500;

/** How often the caption rows are re-read for ones that have settled since their last fragment. */
const CAPTION_SETTLE_TICK_MS = 500;

const SESSION_START_TIMEOUT_MESSAGE = "The voice session did not start.";

interface LiveCallActs {
  createSession: (sdp: string) => Promise<{ sessionId: string; sdpAnswer: string } | undefined>;
  endSession: () => void;
  reportTransport: (state: LiveTransportState) => void;
  reportActivity: (idle: boolean) => void;
}

export interface LiveCallOptions {
  events: LiveVoiceCallEvents;
  acts: LiveCallActs;
  createPeerConnection: () => LivePeerConnection;
  openMicrophone: () => Promise<MediaStream>;
  onRemoteStream: (stream: MediaStream | undefined) => void;
  onLocalStream: (stream: MediaStream | undefined) => void;
  /** The development trace's tap, handed each event as it crossed the channel. */
  onWireEvent?: (direction: TraceDirection, event: WireRecord) => void;
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel: (timer: ScheduledTimer) => void;
}

/** One pending microphone switch, settled by its acknowledgment or the error naming it. */
interface PendingSwitch {
  eventId: string;
  resolve: (acknowledged: boolean) => void;
  timer: ScheduledTimer;
}

type ServerEventHandler<Type extends LiveServerEvent["type"]> = (
  event: Extract<LiveServerEvent, { type: Type }>,
) => void;

type ServerEventHandlers = { [Type in LiveServerEvent["type"]]?: ServerEventHandler<Type> };

/**
 * The voice window's one session as a GPT Live peer. The renderer owns the
 * microphone switch and the hang-up and nothing else: it sends the mute,
 * unmute, and close events the data channel permissions allow it, flips the
 * track only on the acknowledgment, draws both speakers' captions from the
 * transcript deltas, reports its transport and its idle to the host, and
 * reads Luke as speaking from the remote track's playback level rather than
 * from transcript events. Every append is the host's, over its sideband.
 */
export class LiveCall implements LiveVoiceCall {
  readonly #options: LiveCallOptions;
  readonly #captions: LiveCaptions;
  #peer: LivePeer | undefined;
  #status: LiveStatus = LIVE_STATUS.IDLE;
  #started = false;
  #ended = false;
  #closing = false;
  #micLive = false;
  #lukeSpeaking = false;
  #startWaiter: ((started: boolean) => void) | undefined;
  #closeWaiter: (() => void) | undefined;
  #pendingSwitch: PendingSwitch | undefined;
  #idleTimer: ScheduledTimer | undefined;
  #idleReported = false;
  #speakingHangover: ScheduledTimer | undefined;
  #captionTick: ScheduledTimer | undefined;
  #ids = 0;

  constructor(options: LiveCallOptions) {
    this.#options = options;
    this.#captions = new LiveCaptions({
      onRows: (rows) => this.#onRows(rows),
      now: options.now,
    });
  }

  get status(): LiveStatus {
    return this.#status;
  }

  get sessionId(): string | undefined {
    return this.#peer?.sessionId;
  }

  get standing(): boolean {
    return this.#peer !== undefined && !this.#ended;
  }

  get listening(): boolean {
    return this.standing && this.#micLive;
  }

  async open(): Promise<boolean> {
    if (this.#peer) return this.standing;
    this.#setStatus(LIVE_STATUS.CONNECTING);
    const opening = await openLivePeer({
      createPeerConnection: this.#options.createPeerConnection,
      openMicrophone: this.#options.openMicrophone,
      createSession: this.#options.acts.createSession,
      onRemoteStream: (stream) => this.#options.onRemoteStream(stream),
      schedule: this.#options.schedule,
      cancel: this.#options.cancel,
    });
    if (opening.outcome !== LIVE_PEER_OUTCOME.OPENED) {
      this.#options.events.onError(opening.message);
      this.#setStatus(LIVE_STATUS.FAILED);
      return false;
    }
    const peer = opening.peer;
    this.#peer = peer;
    this.#options.onLocalStream(peer.microphoneStream);
    peer.connection.onconnectionstatechange = () => this.#onTransport(peer);
    peer.channel.onmessage = (message) => this.#onMessage(message);
    peer.channel.onclose = () => this.#onChannelClosed();
    const started = await this.#awaitStart();
    if (!started) {
      if (!this.#ended) {
        this.#options.events.onError(SESSION_START_TIMEOUT_MESSAGE);
        this.#tearDown(LIVE_STATUS.FAILED);
      }
      return false;
    }
    return true;
  }

  async unmute(): Promise<boolean> {
    const peer = this.#peer;
    if (!peer || !this.#started || this.#ended) return false;
    if (!peer.microphone) {
      try {
        const stream = await this.#options.openMicrophone();
        const track = stream.getAudioTracks()[0];
        if (!track) return false;
        track.enabled = false;
        await peer.sender.replaceTrack(track);
        peer.microphone = track;
        peer.microphoneStream = stream;
        this.#options.onLocalStream(stream);
      } catch {
        return false;
      }
    }
    if (this.#micLive) return true;
    const acknowledged = await this.#switchMicrophone(unmuteEvent);
    if (!acknowledged || !this.#peer?.microphone) return false;
    this.#peer.microphone.enabled = true;
    this.#micLive = true;
    this.#armIdle();
    this.#refreshStatus();
    return true;
  }

  /**
   * The stop: an unmute still waiting on its acknowledgment is given up
   * first, and the mute goes whatever the track shows, since the server may
   * still be about to honour the unmute it was asked for.
   */
  async mute(): Promise<boolean> {
    const peer = this.#peer;
    if (!peer || !this.#started || this.#ended) return false;
    const unmuting = this.#pendingSwitch !== undefined;
    if (!this.#micLive && !unmuting) return true;
    const acknowledged = await this.#switchMicrophone(muteEvent);
    if (!acknowledged) return false;
    if (peer.microphone) peer.microphone.enabled = false;
    this.#micLive = false;
    this.#armIdle();
    this.#refreshStatus();
    return true;
  }

  /**
   * The graceful hang-up the conversations guide prescribes: the closed
   * handler already stands, `session.close` goes, and everything stays open
   * until `session.closed` arrives or the bound passes.
   */
  async close(): Promise<void> {
    const peer = this.#peer;
    if (!peer || this.#ended) return;
    if (this.#closing) return;
    this.#closing = true;
    this.#setStatus(LIVE_STATUS.CLOSING);
    // A channel that cannot carry the close leaves the hang-up to the host,
    // whose sideband can still close the session gracefully.
    if (!this.#started || peer.channel.readyState !== "open") {
      this.#options.acts.endSession();
      this.#tearDown(LIVE_STATUS.IDLE);
      return;
    }
    const closed = new Promise<void>((resolve) => {
      this.#closeWaiter = resolve;
    });
    this.#send(closeEvent(this.#nextId()));
    const timer = this.#schedule(() => this.#closeWaiter?.(), SESSION_CLOSE_TIMEOUT_MS);
    await closed;
    this.#cancel(timer);
    this.#closeWaiter = undefined;
    if (!this.#ended) this.#tearDown(LIVE_STATUS.IDLE);
  }

  /** Luke audible on the remote track, from the level meter: the one source of the speaking status, held through his pauses. */
  reportRemoteAudioLevel(active: boolean): void {
    if (this.#speakingHangover !== undefined) {
      this.#cancel(this.#speakingHangover);
      this.#speakingHangover = undefined;
    }
    if (active) {
      if (this.#lukeSpeaking) return;
      this.#lukeSpeaking = true;
      this.#refreshStatus();
      return;
    }
    if (!this.#lukeSpeaking) return;
    this.#speakingHangover = this.#schedule(() => {
      this.#speakingHangover = undefined;
      this.#lukeSpeaking = false;
      this.#refreshStatus();
    }, SPEAKING_HANGOVER_MS);
  }

  /** Speech energy on the microphone, from the level meter: what resets the idle window. */
  reportMicrophoneActivity(active: boolean): void {
    if (!active || !this.standing) return;
    if (this.#idleReported) {
      this.#idleReported = false;
      this.#options.acts.reportActivity(false);
    }
    this.#armIdle();
  }

  readonly #handlers: ServerEventHandlers = {
    [LIVE_SERVER_EVENT.SESSION_STARTED]: () => {
      this.#started = true;
      this.#startWaiter?.(true);
      this.#refreshStatus();
      this.#armIdle();
    },
    [LIVE_SERVER_EVENT.SESSION_CLOSED]: () => {
      this.#closeWaiter?.();
      this.#tearDown(LIVE_STATUS.IDLE);
    },
    [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED]: (event) => this.#acknowledge(event.client_event_id),
    [LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED]: (event) => this.#acknowledge(event.client_event_id),
    [LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA]: (event) =>
      this.#captions.append(TRANSCRIPT_SPEAKER.USER, event.delta, event.start_ms, event.end_ms),
    [LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA]: (event) =>
      this.#captions.append(
        TRANSCRIPT_SPEAKER.ASSISTANT,
        event.delta,
        event.start_ms,
        event.end_ms,
      ),
    [LIVE_SERVER_EVENT.ERROR]: (event) => {
      const about = event.client_event_id ?? event.error.client_event_id;
      if (about !== undefined && this.#pendingSwitch?.eventId === about) this.#settleSwitch(false);
    },
  };

  #onMessage(message: MessageEvent): void {
    // SAFETY: a data channel message's data is the text the channel carried, decoded by the grammar's own reader.
    const payload = decodeLivePayload(message.data as UnparsedWireValue);
    if (!payload) return;
    this.#options.onWireEvent?.(TRACE_DIRECTION.SERVER, payload);
    const event = parseLiveServerEvent(payload);
    if (!event) return;
    // SAFETY: the table is keyed by the event's own type, so the handler found takes this event.
    const handler = this.#handlers[event.type] as ((event: LiveServerEvent) => void) | undefined;
    handler?.(event);
  }

  #awaitStart(): Promise<boolean> {
    if (this.#started) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = this.#schedule(() => {
        this.#startWaiter = undefined;
        resolve(false);
      }, SESSION_START_TIMEOUT_MS);
      this.#startWaiter = (started) => {
        this.#cancel(timer);
        this.#startWaiter = undefined;
        resolve(started);
      };
    });
  }

  #switchMicrophone(build: (eventId: string) => LiveClientEvent): Promise<boolean> {
    if (this.#pendingSwitch) this.#settleSwitch(false);
    const eventId = this.#nextId();
    return new Promise<boolean>((resolve) => {
      const timer = this.#schedule(() => {
        if (this.#pendingSwitch?.eventId === eventId) this.#settleSwitch(false);
      }, MICROPHONE_ACK_TIMEOUT_MS);
      this.#pendingSwitch = { eventId, resolve, timer };
      this.#send(build(eventId));
    });
  }

  #acknowledge(clientEventId: string | undefined): void {
    if (clientEventId === undefined || this.#pendingSwitch?.eventId !== clientEventId) return;
    this.#settleSwitch(true);
  }

  #settleSwitch(acknowledged: boolean): void {
    const pending = this.#pendingSwitch;
    if (!pending) return;
    this.#pendingSwitch = undefined;
    this.#cancel(pending.timer);
    pending.resolve(acknowledged);
  }

  #send(event: LiveClientEvent): void {
    const peer = this.#peer;
    if (!peer || peer.channel.readyState !== "open") return;
    const data = JSON.stringify(event);
    const payload = decodeLivePayload(data);
    if (payload) this.#options.onWireEvent?.(TRACE_DIRECTION.CLIENT, payload);
    peer.channel.send(data);
  }

  // The peer connection's own state names are the transport report's; the
  // report's schema is what says which of them the host is told.
  #onTransport(peer: LivePeer): void {
    const state = voiceReportLiveTransportParamsSchema.parse({
      state: peer.connection.connectionState,
    })?.state;
    if (state === undefined) return;
    this.#options.acts.reportTransport(state);
    if (state === LIVE_TRANSPORT_STATE.FAILED && !this.#ended) {
      this.#startWaiter?.(false);
      this.#tearDown(LIVE_STATUS.FAILED);
    }
  }

  #onChannelClosed(): void {
    if (this.#ended) return;
    this.#startWaiter?.(false);
    this.#closeWaiter?.();
    this.#tearDown(LIVE_STATUS.IDLE);
  }

  #onRows(rows: readonly LiveCaptionRow[]): void {
    this.#options.events.onCaptions(rows);
    if (this.#captionTick !== undefined) this.#cancel(this.#captionTick);
    if (rows.every((row) => row.settled) || this.#ended) {
      this.#captionTick = undefined;
      return;
    }
    this.#captionTick = this.#schedule(() => {
      this.#captionTick = undefined;
      this.#captions.tick();
    }, CAPTION_SETTLE_TICK_MS);
  }

  #armIdle(): void {
    if (this.#idleTimer !== undefined) this.#cancel(this.#idleTimer);
    this.#idleTimer = this.#schedule(() => {
      this.#idleTimer = undefined;
      if (!this.standing || this.#idleReported) return;
      this.#idleReported = true;
      this.#options.acts.reportActivity(true);
    }, LIVE_IDLE_WINDOW_MS);
  }

  #refreshStatus(): void {
    if (this.#ended || this.#closing) return;
    if (!this.#started) {
      this.#setStatus(LIVE_STATUS.CONNECTING);
      return;
    }
    this.#setStatus(
      this.#lukeSpeaking
        ? LIVE_STATUS.SPEAKING
        : this.#micLive
          ? LIVE_STATUS.LISTENING
          : LIVE_STATUS.MUTED,
    );
  }

  #setStatus(status: LiveStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.events.onStatus(status);
  }

  /**
   * Every end of the peer, however it came. The host is told the transport
   * closed as the last thing before the handlers go: a peer closed locally
   * fires no state change of its own, and a host left thinking a session
   * stands would keep speaking into it, so the report is what lets the host
   * end a session whose peer is already gone.
   */
  #tearDown(status: LiveStatus): void {
    if (this.#ended) return;
    this.#ended = true;
    const peer = this.#peer;
    if (this.#idleTimer !== undefined) this.#cancel(this.#idleTimer);
    this.#idleTimer = undefined;
    if (this.#captionTick !== undefined) this.#cancel(this.#captionTick);
    this.#captionTick = undefined;
    if (this.#speakingHangover !== undefined) this.#cancel(this.#speakingHangover);
    this.#speakingHangover = undefined;
    this.#settleSwitch(false);
    this.#startWaiter?.(false);
    if (peer) {
      peer.channel.onmessage = null;
      peer.channel.onclose = null;
      peer.connection.onconnectionstatechange = null;
      teardown(peer.connection, peer.microphoneStream);
      this.#options.acts.reportTransport(LIVE_TRANSPORT_STATE.CLOSED);
    }
    this.#micLive = false;
    this.#lukeSpeaking = false;
    this.#options.onLocalStream(undefined);
    this.#options.onRemoteStream(undefined);
    this.#setStatus(status);
  }

  #nextId(): string {
    this.#ids += 1;
    return `peer-${this.#ids}`;
  }

  #schedule(callback: () => void, delayMs: number): ScheduledTimer {
    return this.#options.schedule(callback, delayMs);
  }

  #cancel(timer: ScheduledTimer): void {
    this.#options.cancel(timer);
  }
}
