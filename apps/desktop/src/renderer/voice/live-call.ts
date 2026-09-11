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
import type {
  LiveCaptionRow,
  LiveVoiceCall,
  LiveVoiceCallEvents,
  LiveVoiceCallOpening,
} from "@sidecar/voice/orchestrator";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  type Fiber,
  FiberId,
  Runtime,
  type Scope,
} from "effect";
import { LiveCaptions } from "./live-captions";
import {
  acquireLivePeer,
  LIVE_PEER_OUTCOME,
  type LivePeer,
  type LivePeerConnection,
  stopDevice,
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
  /**
   * The renderer's own runtime edge, which this bundle has one of: every wait
   * and every bound of the call is a fiber forked on it, and the clock the
   * captions are stamped from is its clock, so a test drives both by advancing
   * a `TestClock` rather than by standing a timer seam in.
   */
  runtime: Runtime.Runtime<never>;
}

/** One pending microphone switch, settled by its acknowledgment or the error naming it. */
interface PendingSwitch {
  eventId: string;
  acknowledged: Deferred.Deferred<boolean>;
}

type ServerEventHandler<Type extends LiveServerEvent["type"]> = (
  event: Extract<LiveServerEvent, { type: Type }>,
) => void;

type ServerEventHandlers = { [Type in LiveServerEvent["type"]]?: ServerEventHandler<Type> };

/**
 * The voice window's one session as a GPT Live peer. The renderer owns the
 * microphone switch and the hang-up and nothing else: it sends the mute,
 * unmute, and close events the data channel permissions allow it, opens the
 * capture device for the unmute and releases it after the mute so the device
 * is open exactly while the talk key is held, flips the track only on the
 * acknowledgment, draws both speakers' captions from the transcript deltas,
 * reports its transport and its idle to the host, and reads Luke as speaking
 * from the remote track's playback level rather than from transcript events.
 * Every append is the host's, over its sideband.
 *
 * The session's life is one fiber on the renderer's runtime, holding the scope
 * the peer was acquired into: the fiber ends when the call does, and the peer
 * is released then — or when the fiber is interrupted — exactly once, because
 * a scope closes once. Every bound the call keeps is an `Effect.sleep` forked
 * into that same scope, so nothing is left armed behind a session that ended.
 *
 * @deprecated The four verbs answer promises because {@link LiveVoiceCall} is
 * what the policy above the peer still holds, so each runs its effect on the
 * runtime the call was handed rather than on one of its own. P9-08 deletes the
 * promise-facing seam once the hooks and the orchestrator take the fiber.
 */
export class LiveCall implements LiveVoiceCall {
  readonly #options: LiveCallOptions;
  readonly #runtime: Runtime.Runtime<never>;
  readonly #captions: LiveCaptions;
  /** The session's life: while it stands, so does the scope the peer was acquired into. */
  #lifecycle: Fiber.RuntimeFiber<void> | undefined;
  /** The open still negotiating, so a second ask reads its answer rather than a session that is not standing yet. */
  #opening: Deferred.Deferred<boolean> | undefined;
  #scope: Scope.Scope | undefined;
  /** Completed by every end of the call, which is what lets the lifecycle fiber unwind. */
  readonly #ending = Deferred.unsafeMake<void>(FiberId.none);
  readonly #announcedStart = Deferred.unsafeMake<boolean>(FiberId.none);
  readonly #announcedClose = Deferred.unsafeMake<void>(FiberId.none);
  #peer: LivePeer | undefined;
  #status: LiveStatus = LIVE_STATUS.IDLE;
  #started = false;
  #ended = false;
  #closing = false;
  #micLive = false;
  #lukeSpeaking = false;
  #pendingSwitch: PendingSwitch | undefined;
  #idleTimer: Fiber.RuntimeFiber<void> | undefined;
  #idleReported = false;
  #speakingHangover: Fiber.RuntimeFiber<void> | undefined;
  #captionTick: Fiber.RuntimeFiber<void> | undefined;
  /** Counts the mutes, so an unmute still opening its device learns the key came up while it waited. */
  #muteEpoch = 0;
  /** The mute under way, so a press landing before its release has settled waits for the device to be let go of first. */
  #muting: Deferred.Deferred<boolean> | undefined;
  #ids = 0;

  constructor(options: LiveCallOptions) {
    this.#options = options;
    this.#runtime = options.runtime;
    this.#captions = new LiveCaptions({
      onRows: (rows) => this.#onRows(rows),
      now: () => this.#now(),
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

  open(opening: LiveVoiceCallOpening): Promise<boolean> {
    const negotiating = this.#opening;
    if (negotiating) return this.#run(Deferred.await(negotiating));
    if (this.#lifecycle) return Promise.resolve(this.standing);
    const opened = Deferred.unsafeMake<boolean>(FiberId.none);
    this.#opening = opened;
    this.#lifecycle = Runtime.runFork(this.#runtime)(
      Effect.scoped(this.#lifecycleEffect(opening, opened)).pipe(
        Effect.ensuring(this.#settleOpening(opened, false)),
      ),
    );
    return this.#run(Deferred.await(opened));
  }

  /**
   * The talk key's press: the device is opened here, at the press, when none
   * stands, and put on the sending line before the switch goes. A key that
   * came up while the device was still opening or attaching leaves it
   * stopped and off the line, since the mute that release sent found nothing
   * to release.
   */
  unmute(): Promise<boolean> {
    return this.#run(this.#unmuteEffect());
  }

  /**
   * The talk key's release, and the stop: an unmute still waiting on its
   * acknowledgment is given up first, and the mute goes whatever the track
   * shows, since the server may still be about to honour the unmute it was
   * asked for. The device is released only once the mute is answered,
   * acknowledged or not, so the model is not fed a vanishing track while the
   * switch is still in flight; released it is, whatever the answer, because
   * the key being up is the developer's decision and the device is theirs.
   * The answer stays the session's own word on the switch.
   */
  mute(): Promise<boolean> {
    const held = this.#muting;
    if (held) return this.#run(Deferred.await(held));
    const peer = this.#peer;
    if (!peer || !this.#started || this.#ended) return Promise.resolve(false);
    this.#muteEpoch += 1;
    const muting = Deferred.unsafeMake<boolean>(FiberId.none);
    this.#muting = muting;
    return this.#run(
      Effect.onExit(this.#muteAndRelease(peer), (exit) =>
        Effect.sync(() => {
          this.#muting = undefined;
          Deferred.unsafeDone(muting, exit);
        }),
      ),
    );
  }

  /**
   * The graceful hang-up the conversations guide prescribes: the closed
   * handler already stands, `session.close` goes, and everything stays open
   * until `session.closed` arrives or the bound passes.
   */
  close(): Promise<void> {
    return this.#run(this.#closeEffect());
  }

  /** Luke audible on the remote track, from the level meter: the one source of the speaking status, held through his pauses. */
  reportRemoteAudioLevel(active: boolean): void {
    if (this.#speakingHangover !== undefined) {
      this.#disarm(this.#speakingHangover);
      this.#speakingHangover = undefined;
    }
    if (active) {
      if (this.#lukeSpeaking) return;
      this.#lukeSpeaking = true;
      this.#refreshStatus();
      return;
    }
    if (!this.#lukeSpeaking) return;
    this.#speakingHangover = this.#arm(SPEAKING_HANGOVER_MS, () => {
      this.#speakingHangover = undefined;
      this.#lukeSpeaking = false;
      this.#refreshStatus();
    });
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
      Deferred.unsafeDone(this.#announcedStart, Exit.succeed(true));
      this.#refreshStatus();
      this.#armIdle();
    },
    [LIVE_SERVER_EVENT.SESSION_CLOSED]: () => {
      Deferred.unsafeDone(this.#announcedClose, Exit.void);
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

  /**
   * The session's whole life, in the scope the peer belongs to: the scope
   * closes when this returns, whether the open failed, the call ended, or the
   * fiber was interrupted.
   */
  #lifecycleEffect(
    opening: LiveVoiceCallOpening,
    opened: Deferred.Deferred<boolean>,
  ): Effect.Effect<void, never, Scope.Scope> {
    return Effect.gen(this, function* () {
      this.#scope = yield* Effect.scope;
      const standing = yield* this.#openEffect(opening);
      yield* this.#settleOpening(opened, standing);
      if (standing) yield* Deferred.await(this.#ending);
    });
  }

  /**
   * The open's answer, and the end of its being in flight: an ask arriving
   * from here reads the call's own standing, since the peer either stands or
   * never will.
   */
  #settleOpening(opened: Deferred.Deferred<boolean>, standing: boolean): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#opening = undefined;
      return Effect.asVoid(Deferred.succeed(opened, standing));
    });
  }

  #openEffect(opening: LiveVoiceCallOpening): Effect.Effect<boolean, never, Scope.Scope> {
    return Effect.gen(this, function* () {
      this.#setStatus(LIVE_STATUS.CONNECTING);
      const opened = yield* acquireLivePeer({
        createPeerConnection: this.#options.createPeerConnection,
        ...(opening.byPress ? { openMicrophone: this.#options.openMicrophone } : undefined),
        createSession: this.#options.acts.createSession,
        onRemoteStream: (stream) => this.#options.onRemoteStream(stream),
      });
      if (opened.outcome !== LIVE_PEER_OUTCOME.OPENED) {
        this.#options.events.onError(opened.message);
        this.#setStatus(LIVE_STATUS.FAILED);
        return false;
      }
      const peer = opened.peer;
      this.#peer = peer;
      this.#options.onLocalStream(peer.microphoneStream);
      peer.connection.onconnectionstatechange = () => this.#onTransport(peer);
      peer.channel.onmessage = (message) => this.#onMessage(message);
      peer.channel.onclose = () => this.#onChannelClosed();
      const started = yield* this.#awaitStart();
      if (started) return true;
      if (!this.#ended) {
        this.#options.events.onError(SESSION_START_TIMEOUT_MESSAGE);
        this.#tearDown(LIVE_STATUS.FAILED);
      }
      return false;
    });
  }

  #awaitStart(): Effect.Effect<boolean> {
    if (this.#started) return Effect.succeed(true);
    return Effect.race(
      Deferred.await(this.#announcedStart),
      Effect.as(Effect.sleep(Duration.millis(SESSION_START_TIMEOUT_MS)), false),
    );
  }

  #unmuteEffect(): Effect.Effect<boolean> {
    return Effect.gen(this, function* () {
      for (let muting = this.#muting; muting; muting = this.#muting) yield* Deferred.await(muting);
      const peer = this.#peer;
      if (!peer || !this.#started || this.#ended) return false;
      if (!peer.microphoneStream) {
        const epoch = this.#muteEpoch;
        const stream = yield* Effect.tryPromise(() => this.#options.openMicrophone()).pipe(
          Effect.orElseSucceed(() => undefined),
        );
        if (!stream) return false;
        const track = stream.getAudioTracks()[0];
        if (!track || epoch !== this.#muteEpoch || this.#ended) {
          stopDevice(stream);
          return false;
        }
        track.enabled = false;
        const attached = yield* Effect.tryPromise(() => peer.sender.replaceTrack(track)).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (!attached) {
          stopDevice(stream);
          return false;
        }
        if (epoch !== this.#muteEpoch || this.#ended) {
          yield* this.#takeOffLine(peer, stream);
          return false;
        }
        peer.microphone = track;
        peer.microphoneStream = stream;
        this.#options.onLocalStream(stream);
      }
      if (this.#micLive) return true;
      const acknowledged = yield* this.#switchMicrophone(unmuteEvent);
      if (!acknowledged || !this.#peer?.microphone) return false;
      this.#peer.microphone.enabled = true;
      this.#micLive = true;
      this.#armIdle();
      this.#refreshStatus();
      return true;
    });
  }

  #muteAndRelease(peer: LivePeer): Effect.Effect<boolean> {
    return Effect.gen(this, function* () {
      const unmuting = this.#pendingSwitch !== undefined;
      const acknowledged =
        this.#micLive || unmuting ? yield* this.#switchMicrophone(muteEvent) : true;
      yield* this.#releaseDevice(peer);
      this.#micLive = false;
      this.#armIdle();
      this.#refreshStatus();
      return acknowledged;
    });
  }

  #closeEffect(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const peer = this.#peer;
      if (!peer || this.#ended || this.#closing) return;
      this.#closing = true;
      this.#setStatus(LIVE_STATUS.CLOSING);
      // A channel that cannot carry the close leaves the hang-up to the host,
      // whose sideband can still close the session gracefully.
      if (!this.#started || peer.channel.readyState !== "open") {
        this.#options.acts.endSession();
        this.#tearDown(LIVE_STATUS.IDLE);
        return;
      }
      this.#send(closeEvent(this.#nextId()));
      yield* Effect.race(
        Deferred.await(this.#announcedClose),
        Effect.sleep(Duration.millis(SESSION_CLOSE_TIMEOUT_MS)),
      );
      if (!this.#ended) this.#tearDown(LIVE_STATUS.IDLE);
    });
  }

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

  #switchMicrophone(build: (eventId: string) => LiveClientEvent): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      if (this.#pendingSwitch) this.#settleSwitch(false);
      const eventId = this.#nextId();
      const acknowledged = Deferred.unsafeMake<boolean>(FiberId.none);
      this.#pendingSwitch = { eventId, acknowledged };
      this.#send(build(eventId));
      return Effect.race(
        Deferred.await(acknowledged),
        Effect.as(Effect.sleep(Duration.millis(MICROPHONE_ACK_TIMEOUT_MS)), false),
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (this.#pendingSwitch?.eventId === eventId) this.#settleSwitch(false);
          }),
        ),
      );
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
    Deferred.unsafeDone(pending.acknowledged, Exit.succeed(acknowledged));
  }

  #send(event: LiveClientEvent): void {
    const peer = this.#peer;
    if (peer?.channel.readyState !== "open") return;
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
      Deferred.unsafeDone(this.#announcedStart, Exit.succeed(false));
      this.#tearDown(LIVE_STATUS.FAILED);
    }
  }

  #onChannelClosed(): void {
    if (this.#ended) return;
    Deferred.unsafeDone(this.#announcedStart, Exit.succeed(false));
    Deferred.unsafeDone(this.#announcedClose, Exit.void);
    this.#tearDown(LIVE_STATUS.IDLE);
  }

  #onRows(rows: readonly LiveCaptionRow[]): void {
    this.#options.events.onCaptions(rows);
    if (this.#captionTick !== undefined) this.#disarm(this.#captionTick);
    if (rows.every((row) => row.settled) || this.#ended) {
      this.#captionTick = undefined;
      return;
    }
    this.#captionTick = this.#arm(CAPTION_SETTLE_TICK_MS, () => {
      this.#captionTick = undefined;
      this.#captions.tick();
    });
  }

  #armIdle(): void {
    if (this.#idleTimer !== undefined) this.#disarm(this.#idleTimer);
    this.#idleTimer = this.#arm(LIVE_IDLE_WINDOW_MS, () => {
      this.#idleTimer = undefined;
      if (!this.standing || this.#idleReported) return;
      this.#idleReported = true;
      this.#options.acts.reportActivity(true);
    });
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
   * end a session whose peer is already gone. The connection itself is the
   * scope's to close, which completing {@link #ending} is what asks for; a
   * device this call opened after the offer is stopped here, and stopping a
   * track twice is a no-op, so the two cannot fight over the one the offer
   * rode.
   */
  #tearDown(status: LiveStatus): void {
    if (this.#ended) return;
    this.#ended = true;
    const peer = this.#peer;
    if (this.#idleTimer !== undefined) this.#disarm(this.#idleTimer);
    this.#idleTimer = undefined;
    if (this.#captionTick !== undefined) this.#disarm(this.#captionTick);
    this.#captionTick = undefined;
    if (this.#speakingHangover !== undefined) this.#disarm(this.#speakingHangover);
    this.#speakingHangover = undefined;
    this.#settleSwitch(false);
    Deferred.unsafeDone(this.#announcedStart, Exit.succeed(false));
    if (peer) {
      peer.channel.onmessage = null;
      peer.channel.onclose = null;
      peer.connection.onconnectionstatechange = null;
      stopDevice(peer.microphoneStream);
      this.#options.acts.reportTransport(LIVE_TRANSPORT_STATE.CLOSED);
    }
    this.#micLive = false;
    this.#lukeSpeaking = false;
    this.#options.onLocalStream(undefined);
    this.#options.onRemoteStream(undefined);
    this.#setStatus(status);
    Deferred.unsafeDone(this.#ending, Exit.void);
  }

  /** Takes the device off the sending line and stops it, so the system's indicator goes out with the key. */
  #releaseDevice(peer: LivePeer): Effect.Effect<void> {
    return Effect.suspend(() => {
      const stream = peer.microphoneStream;
      if (!stream) return Effect.void;
      peer.microphone = undefined;
      peer.microphoneStream = undefined;
      return this.#takeOffLine(peer, stream).pipe(
        Effect.andThen(Effect.sync(() => this.#options.onLocalStream(undefined))),
      );
    });
  }

  #takeOffLine(peer: LivePeer, stream: MediaStream): Effect.Effect<void> {
    return Effect.tryPromise(() => peer.sender.replaceTrack(null)).pipe(
      // A line already closed has nothing to take the track off; the device is stopped either way.
      Effect.ignore,
      Effect.andThen(Effect.sync(() => stopDevice(stream))),
    );
  }

  #nextId(): string {
    this.#ids += 1;
    return `peer-${this.#ids}`;
  }

  #now(): number {
    return Runtime.runSync(this.#runtime)(Clock.currentTimeMillis);
  }

  #run<A>(effect: Effect.Effect<A>): Promise<A> {
    return Runtime.runPromise(this.#runtime)(effect);
  }

  /**
   * A bound, forked into the session's own scope so it goes with the call.
   * Nothing hands a handle back to be cancelled: what a caller holds is the
   * fiber, and re-arming interrupts the one it replaces.
   */
  #arm(delayMs: number, work: () => void): Fiber.RuntimeFiber<void> {
    const scope = this.#scope;
    return Runtime.runFork(this.#runtime)(
      Effect.andThen(Effect.sleep(Duration.millis(delayMs)), Effect.sync(work)),
      scope ? { scope } : undefined,
    );
  }

  /**
   * Interrupts a bound without waiting for the interruption to finish: what it
   * has to guarantee is that the work does not run afterwards, never that the
   * fiber has already ended.
   */
  #disarm(fiber: Fiber.RuntimeFiber<void>): void {
    fiber.unsafeInterruptAsFork(FiberId.none);
  }
}
