import { Duration, Effect, type Scope } from "effect";

/**
 * The WebRTC peer the voice window is, as the WebRTC guide builds one: the
 * audio line first (the microphone's track where a press opened the session,
 * the peer's own silent track otherwise), the `oai-events` data channel
 * created before the offer, ICE gathered under a bound, the offer handed to
 * the host that holds the key, and the host's answer applied. The HTTP
 * request the host makes is what starts the session, so nothing here sends
 * `session.start`. The peer is written over the narrowest slice of the
 * browser's objects the peer touches, so a test can stand a fake in for each
 * without a browser.
 *
 * The line always carries a track. GPT Live is full duplex and paces its
 * output against the input timeline, and the conversations guide asks that
 * input audio keep running through silence: on WebRTC, that the negotiated
 * input track stay active. A sender with no track stalls that timeline, so a
 * reply appended while the talk key was up was held until the next press put
 * a track back, then unloaded whole. The silence is synthesized here rather
 * than captured, so no device stands behind it and the system's microphone
 * indicator still answers to the key alone.
 *
 * The peer is acquired into the caller's `Scope` rather than handed over to be
 * closed by hand: the connection, the silence, and the device that rode its
 * offer are released when that scope closes, which is the one end a session
 * has, and a scope closes once.
 */

/** How long ICE gathering may run before the offer goes with what it has. */
const ICE_GATHERING_TIMEOUT_MS = 5_000;

/** The label the guide gives the event channel. */
export const LIVE_EVENTS_CHANNEL_LABEL = "oai-events";

const ICE_GATHERING_COMPLETE = "complete";

export interface LiveDataChannel {
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: Event) => void) | null;
}

export interface LiveTrackSender {
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
}

export interface LivePeerConnection {
  readonly connectionState: string;
  readonly iceGatheringState: string;
  readonly localDescription: { readonly sdp: string } | null;
  createDataChannel(label: string): LiveDataChannel;
  addTrack(track: MediaStreamTrack, stream: MediaStream): LiveTrackSender;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
  onicegatheringstatechange: ((event: Event) => void) | null;
  onconnectionstatechange: ((event: Event) => void) | null;
  ontrack: ((event: RTCTrackEvent) => void) | null;
}

/**
 * A synthesized audio track that carries silence for as long as it stands:
 * what the sending line holds whenever the developer's device is not on it.
 */
export interface LiveSilence {
  readonly track: MediaStreamTrack;
  readonly stream: MediaStream;
  release(): void;
}

export interface LivePeerSeams {
  createPeerConnection: () => LivePeerConnection;
  createSilence: () => LiveSilence;
  /**
   * The preferred capture device, handed over only for a session a press
   * opened, since the press is the user action the WebRTC guide asks the
   * microphone be requested from; absent, the session opens on the silent
   * track and its first unmute opens a device. A refusal opens the session
   * the same way, on silence until the first unmute.
   */
  openMicrophone?: () => Promise<MediaStream>;
  /** The host: the peer's offer becomes the one session, answered with the SDP the peer sets. */
  createSession: (sdp: string) => Promise<{ sessionId: string; sdpAnswer: string } | undefined>;
  onRemoteStream: (stream: MediaStream) => void;
}

export interface LivePeer {
  /** The session the host created for this peer's offer, so the host's word about a session can be matched to it. */
  sessionId: string;
  connection: LivePeerConnection;
  channel: LiveDataChannel;
  /** The developer's track while the talk key holds the device open, disabled until the session is unmuted; absent otherwise. */
  microphone: MediaStreamTrack | undefined;
  microphoneStream: MediaStream | undefined;
  /** What the sending line carries whenever the developer's device is not on it, so the input timeline never stalls. */
  silence: MediaStreamTrack;
  sender: LiveTrackSender;
}

export const LIVE_PEER_OUTCOME = {
  OPENED: "opened",
  /** The host created no session for the offer, or the browser could not build the peer or set the answer. */
  FAILED: "failed",
} as const;

export type LivePeerOpening =
  | { outcome: typeof LIVE_PEER_OUTCOME.OPENED; peer: LivePeer }
  | { outcome: typeof LIVE_PEER_OUTCOME.FAILED; message: string };

const SESSION_REFUSED_MESSAGE = "Luke could not open a voice session.";

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Gathering, under its bound: the loser of the race is interrupted, and the
 * handler is cleared whichever won, since the connection outlives this wait.
 */
const gatherIce = (connection: LivePeerConnection): Effect.Effect<void> =>
  connection.iceGatheringState === ICE_GATHERING_COMPLETE
    ? Effect.void
    : Effect.race(
        Effect.async<void>((resume) => {
          connection.onicegatheringstatechange = () => {
            if (connection.iceGatheringState !== ICE_GATHERING_COMPLETE) return;
            resume(Effect.void);
          };
        }),
        Effect.sleep(Duration.millis(ICE_GATHERING_TIMEOUT_MS)),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            connection.onicegatheringstatechange = null;
          }),
        ),
      );

/**
 * The device the offer rides, for a session a press opened. A refusal is not a
 * failure — the session opens on the silent track and the first unmute puts a
 * device on the line. The device a later press opens is the call's own,
 * released by the mute that ends that press; this one is the scope's, so a
 * call ending mid-press releases whichever of them the peer is holding.
 */
const acquireDevice = (
  seams: LivePeerSeams,
): Effect.Effect<MediaStream | undefined, never, Scope.Scope> => {
  const open = seams.openMicrophone;
  if (open === undefined) return Effect.succeed(undefined);
  return Effect.acquireRelease(
    Effect.tryPromise(() => open()).pipe(Effect.orElseSucceed(() => undefined)),
    (stream) => Effect.sync(() => stopDevice(stream)),
  );
};

/**
 * Opens the peer in the guide's order. A press's microphone rides the offer
 * with its track disabled until the session acknowledges the unmute; a
 * session opened for Luke's own speech, or one whose microphone the system
 * refuses, rides on the silent track, which the first unmute swaps a device
 * in for, so no capture device is open behind a session nobody pressed for
 * and the input timeline runs from the offer on either way.
 *
 * A refusal answers rather than fails, so the call can say what went wrong,
 * and releases nothing by hand: whatever was acquired goes when the scope
 * does.
 */
export const acquireLivePeer = (
  seams: LivePeerSeams,
): Effect.Effect<LivePeerOpening, never, Scope.Scope> =>
  Effect.gen(function* () {
    const connection = yield* Effect.acquireRelease(
      Effect.try({ try: () => seams.createPeerConnection(), catch: messageOf }),
      (connection) => Effect.sync(() => connection.close()),
    );
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      seams.onRemoteStream(stream);
    };
    const silence = yield* Effect.acquireRelease(
      Effect.try({ try: () => seams.createSilence(), catch: messageOf }),
      (silence) => Effect.sync(() => silence.release()),
    );
    const microphoneStream = yield* acquireDevice(seams);
    const microphone = microphoneStream?.getAudioTracks()[0];
    const sender = yield* Effect.try({
      try: () => {
        if (microphone && microphoneStream) {
          microphone.enabled = false;
          return connection.addTrack(microphone, microphoneStream);
        }
        return connection.addTrack(silence.track, silence.stream);
      },
      catch: messageOf,
    });
    const channel = yield* Effect.try({
      try: () => connection.createDataChannel(LIVE_EVENTS_CHANNEL_LABEL),
      catch: messageOf,
    });
    const offer = yield* Effect.tryPromise({
      try: () => connection.createOffer(),
      catch: messageOf,
    });
    yield* Effect.tryPromise({
      try: () => connection.setLocalDescription(offer),
      catch: messageOf,
    });
    yield* gatherIce(connection);
    const sdp = connection.localDescription?.sdp;
    if (!sdp) return yield* Effect.fail("the peer produced no local description");
    const created = yield* Effect.tryPromise({
      try: () => seams.createSession(sdp),
      catch: messageOf,
    });
    if (!created) return yield* Effect.fail(SESSION_REFUSED_MESSAGE);
    yield* Effect.tryPromise({
      try: () => connection.setRemoteDescription({ type: "answer", sdp: created.sdpAnswer }),
      catch: messageOf,
    });
    return {
      outcome: LIVE_PEER_OUTCOME.OPENED,
      peer: {
        sessionId: created.sessionId,
        connection,
        channel,
        microphone,
        microphoneStream,
        silence: silence.track,
        sender,
      },
    } satisfies LivePeerOpening;
  }).pipe(
    Effect.catchAll((message) =>
      Effect.succeed({ outcome: LIVE_PEER_OUTCOME.FAILED, message } satisfies LivePeerOpening),
    ),
  );

/** Stops every track of a capture device, so the system's indicator goes with it. */
export function stopDevice(stream: MediaStream | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * The browser's silence: a destination node with nothing feeding it renders
 * zeros for as long as its context runs, and the track it yields is a live
 * audio track the sender encodes like any other. The context is resumed
 * rather than trusted to start, since a suspended one renders nothing and a
 * track that produces no frames is the stall this exists to prevent.
 */
export function createBrowserSilence(): LiveSilence {
  const context = new AudioContext({ latencyHint: "interactive" });
  const destination = context.createMediaStreamDestination();
  void context.resume().catch(() => undefined);
  const stream = destination.stream;
  const track = stream.getAudioTracks()[0];
  if (!track) {
    void context.close().catch(() => undefined);
    throw new Error("the destination node yielded no audio track");
  }
  return {
    track,
    stream,
    release: () => {
      track.stop();
      void context.close().catch(() => undefined);
    },
  };
}
