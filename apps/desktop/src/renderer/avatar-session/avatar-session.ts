import { type Cause, Data, Deferred, Effect, Exit, Queue, type Scope, Stream } from "effect";
import type {
  AvatarGrant,
  AvatarSessionModule,
  PersonaCloseReason,
  PersonaSessionSlice,
} from "./contract";

/**
 * avatar-session.ts -- one call's Keyframe avatar as the call window holds it: its two tracks, the audio fed to it, whether it is speaking, and why it closed.
 *
 * The session is written over the slice of Keyframe's `PersonaSession` the
 * bundle hands over (`./contract.ts`), the way `../voice/live-peer.ts` is
 * written over the browser's peer, so a test stands a fake in for it. The
 * SDK reports through callbacks that belong to no fiber, so each lands in a
 * `Deferred` or a `Queue` the session's readers wait on; nothing here arms a
 * timer. The session is acquired into the caller's `Scope`: closing the
 * scope closes the session, which is the one way a session ends from this
 * side, since Keyframe has no endpoint that stops one.
 *
 * A failure carries its kind and nothing the SDK or LiveKit said, because
 * what they say about a connection can name the room the grant opens.
 */

export const AVATAR_CLOSE_REASON = {
  /** This side closed the session: its scope closed. */
  CLIENT: "client",
  /** Keyframe ended the room or removed the window from it, as the session's length cap does. */
  SERVER_CLOSED: "server_closed",
  /** The room went with no reason given: the connection was lost. */
  LOST: "lost",
} as const;

export type AvatarCloseReason = (typeof AVATAR_CLOSE_REASON)[keyof typeof AVATAR_CLOSE_REASON];

export const AVATAR_SESSION_FAILURE = {
  /** The bundle could not create a session, or the room refused the grant. */
  CONNECT: "connect",
  /** The session closed before the track asked for arrived. */
  CLOSED: "closed",
} as const;

export type AvatarSessionFailure =
  (typeof AVATAR_SESSION_FAILURE)[keyof typeof AVATAR_SESSION_FAILURE];

export class AvatarSessionError extends Data.TaggedError("AvatarSessionError")<{
  readonly failure: AvatarSessionFailure;
}> {}

/** One call's avatar, open for as long as the scope it was opened into. */
export interface AvatarSession {
  /** The avatar's video, once Keyframe publishes it. */
  readonly video: Effect.Effect<MediaStreamTrack, AvatarSessionError>;
  /** The avatar's lip-synced voice, once Keyframe publishes it. */
  readonly audio: Effect.Effect<MediaStreamTrack, AvatarSessionError>;
  /** One chunk of Luke's voice, PCM16LE 24 kHz mono; dropped by the SDK while the room is not connected. */
  readonly sendAudio: (pcm: Uint8Array) => Effect.Effect<void>;
  /** The turn's last chunk has been sent, so the avatar renders the rest of it. */
  readonly endTurn: Effect.Effect<void>;
  /** Drops the frames the avatar has not yet shown. */
  readonly interrupt: Effect.Effect<void>;
  /** Whether the avatar is speaking: `false` first, then each change the playback RPCs report, ending when the session closes. One reader. */
  readonly speaking: Stream.Stream<boolean>;
  /** Why the session closed, once it has. */
  readonly closed: Effect.Effect<AvatarCloseReason>;
}

/** Keyframe's reason, as this window tells its closes apart. */
const closeReasonOf = (reason: PersonaCloseReason): AvatarCloseReason => {
  switch (reason) {
    case "client_initiated":
      return AVATAR_CLOSE_REASON.CLIENT;
    case "room_deleted":
    case "server_shutdown":
    case "participant_removed":
      return AVATAR_CLOSE_REASON.SERVER_CLOSED;
    case "unknown":
      return AVATAR_CLOSE_REASON.LOST;
  }
};

const failure = (kind: AvatarSessionFailure) => () => new AvatarSessionError({ failure: kind });

/**
 * Note that a write's failure is not the caller's: the SDK already swallows
 * the ones it expects, and a session that has died says so through `closed`.
 */
const quietly = (run: () => Promise<void>): Effect.Effect<void> =>
  Effect.ignore(Effect.tryPromise(run));

/**
 * Opens the avatar for a grant: creates the session with its callbacks
 * bridged, registers its close with the scope before connecting, so a
 * connect that fails halfway still leaves the room, and answers once the
 * room is joined. The tracks arrive after; a close before either arrives
 * fails the wait on it rather than leaving it standing.
 */
export const openAvatarSession = /* @__PURE__ */ Effect.fn("desktop/openAvatarSession")(function* (
  grant: AvatarGrant,
  module: AvatarSessionModule,
): Effect.fn.Return<AvatarSession, AvatarSessionError, Scope.Scope> {
  const video = Deferred.makeUnsafe<MediaStreamTrack, AvatarSessionError>();
  const audio = Deferred.makeUnsafe<MediaStreamTrack, AvatarSessionError>();
  const closed = Deferred.makeUnsafe<AvatarCloseReason>();
  const playback = yield* Queue.unbounded<boolean, Cause.Done>();
  const session: PersonaSessionSlice = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        module.createSession({
          serverUrl: grant.serverUrl,
          participantToken: grant.participantToken,
          agentIdentity: grant.agentIdentity,
          onVideoTrack: (track) => Deferred.doneUnsafe(video, Exit.succeed(track)),
          onAudioTrack: (track) => Deferred.doneUnsafe(audio, Exit.succeed(track)),
          onAgentStateChange: (state) => Queue.offerUnsafe(playback, state === "speaking"),
          onClose: (reason) => {
            const gone = Exit.fail(
              new AvatarSessionError({ failure: AVATAR_SESSION_FAILURE.CLOSED }),
            );
            Deferred.doneUnsafe(video, gone);
            Deferred.doneUnsafe(audio, gone);
            Deferred.doneUnsafe(closed, Exit.succeed(closeReasonOf(reason)));
            Queue.endUnsafe(playback);
          },
        }),
      catch: failure(AVATAR_SESSION_FAILURE.CONNECT),
    }),
    (session) => quietly(() => session.close()),
  );
  yield* Effect.tryPromise({
    try: () => session.connect(),
    catch: failure(AVATAR_SESSION_FAILURE.CONNECT),
  });
  return {
    video: Deferred.await(video),
    audio: Deferred.await(audio),
    sendAudio: (pcm) => Effect.sync(() => session.sendAudio(pcm)),
    endTurn: quietly(() => session.endAudioTurn()),
    interrupt: quietly(() => session.interrupt()),
    speaking: Stream.make(false).pipe(Stream.concat(Stream.fromQueue(playback)), Stream.changes),
    closed: Deferred.await(closed),
  } satisfies AvatarSession;
});
