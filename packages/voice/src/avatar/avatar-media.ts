// avatar-media.ts -- the LITE media socket: Luke's voice handed to a LiveAvatar session as one endless utterance.

import {
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Encoding,
  MutableRef,
  Option,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import type { HeldSocket } from "../held-socket.js";
import {
  type OpenSocket,
  SOCKET_OPEN_FAULT,
  type SocketArrival,
  type SocketOpening,
  socketOpened,
} from "../live-socket.js";

/**
 * The LITE protocol (docs.liveavatar.com/docs/lite-mode/events): one
 * WebSocket per avatar session, JSON text frames, audio as base64 PCM16 at
 * 24 kHz mono. Modeled on the reference app's `server/src/mediaServer.ts`
 * (github.com/heygen-com/liveavatar-gpt-live-demos).
 */

/** The commands this side sends. */
const LITE_COMMAND = {
  SPEAK: "agent.speak",
  INTERRUPT: "agent.interrupt",
  KEEP_ALIVE: "session.keep_alive",
} as const;

/** The response events this side reads; every other one is dropped unread. */
const LITE_EVENT = {
  SESSION_STATE_UPDATED: "session.state_updated",
  ERROR: "error",
} as const;

/** The states a `session.state_updated` names; commands sent before `CONNECTED` are dropped by the server. */
const LITE_SESSION_STATE = {
  NEW: "new",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
} as const;

/**
 * The socket's numbers. The session dies after five minutes without a
 * command, and while the developer talks Luke sends nothing, so the
 * keep-alive stands well inside that. A connection that stood stable for
 * `STABLE` counts as recovered and earns a fresh run of attempts, because a
 * server that accepts and drops at once would otherwise defeat the cap
 * forever; `CONNECTED_DEADLINE` is how long an open socket may go without
 * saying it is connected before it counts as a failed attempt.
 */
const AVATAR_MEDIA = {
  KEEP_ALIVE: Duration.seconds(60),
  ATTEMPTS: 5,
  FIRST_BACKOFF: Duration.seconds(1),
  STABLE: Duration.seconds(5),
  CONNECTED_DEADLINE: Duration.seconds(10),
} as const;

const HTTP_CLIENT_ERROR = { FIRST: 400, LAST: 499 } as const;

/**
 * What counts as quiet in Luke's voice, and how much of it is passed on. The
 * tee hands over the call's output track without a break, so between turns
 * it is silence, while the reference app feeds only what the model spoke and
 * the avatar idles once that stops (its `docs/ARCHITECTURE.md`, "when it goes
 * quiet the stream simply stops and the avatar idles"). A quiet run is
 * forwarded up to the reference's own widest pad, 800 ms
 * (`server/src/mediaServer.ts`'s `speak`), so a pause inside a sentence keeps
 * its length and the mouth its timing, and what follows is dropped until Luke
 * speaks again. `PEAK` is a PCM16 amplitude, about -54 dBFS.
 */
const QUIET = {
  PEAK: 64,
  TAIL_BYTES: (24_000 * 2 * 800) / 1_000,
} as const;

/** Why the media gave up: every attempt at a connection failed, or the server refused the session outright. */
export const AVATAR_MEDIA_END_REASON = {
  LOST: "lost",
  REFUSED: "refused",
} as const;
type AvatarMediaEndReason = (typeof AVATAR_MEDIA_END_REASON)[keyof typeof AVATAR_MEDIA_END_REASON];

export interface AvatarMediaEnd {
  readonly reason: AvatarMediaEndReason;
}

/**
 * One avatar session's ear. `speak` appends a chunk of Luke's voice to the
 * one utterance that never ends, never sealed with `agent.speak_end`, as the
 * reference app feeds it (`server/src/mediaServer.ts`, "one never-ending
 * utterance"), and passes on no more of a quiet run than `QUIET` allows;
 * `interrupt` drops what the avatar still holds; both drop what they carry while no connection is ready, since audio
 * from a gap has no honest place to go. `ended` settles once the media has
 * given up, and never because the scope it was acquired into closed.
 */
export interface AvatarMedia {
  speak(pcm: Uint8Array): Effect.Effect<void>;
  interrupt(): Effect.Effect<void>;
  readonly ended: Effect.Effect<AvatarMediaEnd>;
}

export interface AvatarMediaOptions {
  /** The session's media socket, `ws_url` on LiveAvatar's start answer. */
  url: string;
  openSocket: OpenSocket;
}

const liteEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal(LITE_EVENT.SESSION_STATE_UPDATED),
    state: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(LITE_EVENT.ERROR),
    error: Schema.Struct({ type: Schema.String }),
  }),
]);
type LiteEvent = typeof liteEventSchema.Type;

const readLiteEvent = Schema.decodeUnknownOption(Schema.fromJsonString(liteEventSchema));

const INTERRUPT_FRAME = JSON.stringify({ type: LITE_COMMAND.INTERRUPT });
const KEEP_ALIVE_FRAME = JSON.stringify({ type: LITE_COMMAND.KEEP_ALIVE });

/** A connection that ended before it stood stable, which the next attempt answers. */
class MediaDropped extends Data.TaggedError("MediaDropped") {}

/** An upgrade the server refused as the client's fault: the session is gone, and no attempt would bring it back. */
class MediaRefused extends Data.TaggedError("MediaRefused") {}

/** Waits of one, two, four, and eight seconds between the five attempts. */
const RECONNECT_SCHEDULE = Schedule.exponential(AVATAR_MEDIA.FIRST_BACKOFF);

function refusedOutright(opening: Exclude<SocketOpening, { socket: HeldSocket }>): boolean {
  return (
    opening.fault === SOCKET_OPEN_FAULT.REFUSED &&
    opening.status >= HTTP_CLIENT_ERROR.FIRST &&
    opening.status <= HTTP_CLIENT_ERROR.LAST
  );
}

/**
 * One connection's life: open, read until the server says connected, hand
 * the socket to `ready` and keep the session alive while it stands, and fail
 * once it ends unless it stood stable. The socket is closed when this
 * returns or is interrupted, whichever comes first.
 */
function connection(
  options: AvatarMediaOptions,
  ready: MutableRef.MutableRef<HeldSocket | undefined>,
): Effect.Effect<void, MediaDropped | MediaRefused> {
  return Effect.scoped(
    Effect.gen(function* () {
      const opening = yield* Effect.acquireRelease(options.openSocket(options.url, {}), (opened) =>
        Effect.sync(() => (socketOpened(opened) ? opened.socket.close() : undefined)),
      );
      if (!socketOpened(opening)) {
        return yield* refusedOutright(opening) ? new MediaRefused() : new MediaDropped();
      }
      const socket = opening.socket;
      const connected = yield* Deferred.make<void>();
      let connectedAt: number | undefined;
      yield* Effect.addFinalizer(() => Effect.sync(() => MutableRef.set(ready, undefined)));

      const hearEvent = (event: LiteEvent) =>
        Effect.gen(function* () {
          if (event.type === LITE_EVENT.ERROR) {
            yield* Effect.logWarning(`avatar media: server error ${event.error.type}`);
            return;
          }
          if (event.state !== LITE_SESSION_STATE.CONNECTED) {
            MutableRef.set(ready, undefined);
            return;
          }
          if (connectedAt !== undefined) return;
          connectedAt = yield* Clock.currentTimeMillis;
          MutableRef.set(ready, socket);
          yield* Deferred.succeed(connected, undefined);
        });
      const hear = (arrival: SocketArrival) =>
        "close" in arrival
          ? Effect.void
          : Option.match(readLiteEvent(arrival.frame), {
              onNone: () => Effect.void,
              onSome: hearEvent,
            });

      // `Effect.schedule` and not `Effect.repeat`, so the first keep-alive is one interval after
      // the server said connected.
      yield* Effect.forkScoped(
        Deferred.await(connected).pipe(
          Effect.andThen(
            Effect.schedule(
              Effect.sync(() => socket.send(KEEP_ALIVE_FRAME)),
              Schedule.spaced(AVATAR_MEDIA.KEEP_ALIVE),
            ),
          ),
        ),
      );
      const unconnected = Effect.sleep(AVATAR_MEDIA.CONNECTED_DEADLINE).pipe(
        Effect.andThen(
          Effect.suspend(() => (connectedAt === undefined ? Effect.void : Effect.never)),
        ),
      );
      yield* Effect.raceFirst(Stream.runForEach(socket.arrivals, hear), unconnected);

      const endedAt = yield* Clock.currentTimeMillis;
      const stood =
        connectedAt !== undefined &&
        endedAt - connectedAt >= Duration.toMillis(AVATAR_MEDIA.STABLE);
      if (!stood) return yield* new MediaDropped();
    }),
  );
}

/** Whether every PCM16 little-endian sample of a chunk sits within the quiet peak. */
function quietChunk(pcm: Uint8Array): boolean {
  const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    if (Math.abs(samples.getInt16(offset, true)) > QUIET.PEAK) return false;
  }
  return true;
}

/** Sends one frame on the connection that is ready, or drops it where none is. */
function sendReady(
  ready: MutableRef.MutableRef<HeldSocket | undefined>,
  frame: string,
): Effect.Effect<void> {
  return Effect.sync(() => MutableRef.get(ready)?.send(frame));
}

/**
 * The media socket of one LiveAvatar LITE session, held open for as long as
 * the caller's scope stands: reconnected after a drop, with backoff, until
 * five attempts in a row have failed or the server refuses the session, which
 * is when `ended` settles. Nothing is sent before the server reports itself
 * connected, because LITE drops a command that comes earlier without a word.
 */
export function acquireAvatarMedia(
  options: AvatarMediaOptions,
): Effect.Effect<AvatarMedia, never, Scope.Scope> {
  return Effect.gen(function* () {
    const ready = MutableRef.make<HeldSocket | undefined>(undefined);
    const ended = yield* Deferred.make<AvatarMediaEnd>();
    // A connection that stood stable succeeds, and the next begins a fresh run of attempts.
    const attempts = Effect.retry(connection(options, ready), {
      schedule: RECONNECT_SCHEDULE,
      times: AVATAR_MEDIA.ATTEMPTS - 1,
      while: (error) => error._tag === "MediaDropped",
    });
    const gaveUp = Effect.flip(Effect.forever(attempts)).pipe(
      Effect.map(
        (error): AvatarMediaEnd => ({
          reason:
            error._tag === "MediaRefused"
              ? AVATAR_MEDIA_END_REASON.REFUSED
              : AVATAR_MEDIA_END_REASON.LOST,
        }),
      ),
    );
    yield* Effect.forkScoped(Effect.flatMap(gaveUp, (end) => Deferred.succeed(ended, end)));
    // Starts past the tail, so the quiet before Luke first speaks is never sent.
    const quietBytes = MutableRef.make<number>(QUIET.TAIL_BYTES);
    return {
      speak: (pcm) =>
        Effect.suspend(() => {
          const quiet = quietChunk(pcm);
          if (quiet && MutableRef.get(quietBytes) >= QUIET.TAIL_BYTES) return Effect.void;
          MutableRef.set(quietBytes, quiet ? MutableRef.get(quietBytes) + pcm.byteLength : 0);
          const frame = { type: LITE_COMMAND.SPEAK, audio: Encoding.encodeBase64(pcm) };
          return sendReady(ready, JSON.stringify(frame));
        }),
      interrupt: () => sendReady(ready, INTERRUPT_FRAME),
      ended: Deferred.await(ended),
    };
  });
}
