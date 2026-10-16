import { type Cause, Data, Deferred, Effect, Exit, Queue, type Scope, Stream } from "effect";
import type {
  AvatarGrant,
  AvatarSessionModule,
  PersonaCloseReason,
  PersonaSessionSlice,
} from "./avatar-session-contract.js";

/**
 * avatar-session.ts -- one call's Keyframe avatar as the panel holds it: its two tracks, the audio fed to it, whether it is speaking, and why it closed.
 *
 * The session is written over the slice of Keyframe's `PersonaSession` the
 * bundle hands over (`./avatar-session-contract.ts`), the way the desktop's `voice/live-peer.ts` is
 * written over the browser's peer, so a test stands a fake in for it. The
 * SDK reports through callbacks that belong to no fiber, so each lands in a
 * `Deferred` or a `Queue` the session's readers wait on; nothing here arms a
 * timer. The session is acquired into the caller's `Scope`: closing the
 * scope closes the session, which is the one way a session ends from this
 * side, since Keyframe has no endpoint that stops one. The SDK's `close()`
 * waits for the audio writes already queued and then leaves the room
 * without waiting, so `closed` answers from the SDK's own close report,
 * which lands after `close()` has returned, rather than from the call.
 *
 * A failure carries its kind and nothing the SDK or LiveKit said, because
 * what they say about a connection can name the room the grant opens.
 */

/** Why a session closed, named as the call's avatar end reasons name them. */
export const AVATAR_CLOSE_REASON = {
  /** This side closed the session: its scope closed. */
  USER: "user",
  /** Keyframe deleted the room, as the plan's length cap does, shut down, or removed the window from it. */
  SERVER_CLOSED: "server_closed",
  /** The room went with no reason given. */
  ERROR: "error",
} as const;

export type AvatarCloseReason = (typeof AVATAR_CLOSE_REASON)[keyof typeof AVATAR_CLOSE_REASON];

export const AVATAR_SESSION_FAILURE = {
  /** The bundle could not create a session, or the room refused the grant: the call reports it as an error end. */
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
  /** One chunk of Luke's voice, PCM16LE 24 kHz mono. Each of the three below does nothing once the session has closed. */
  readonly sendAudio: (pcm: Uint8Array) => Effect.Effect<void>;
  /** The turn's last chunk has been sent, so the avatar renders the rest of it. */
  readonly endTurn: Effect.Effect<void>;
  /** Drops the frames the avatar has not yet shown. Sent unreliably by the SDK, so it can be lost. */
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
      return AVATAR_CLOSE_REASON.USER;
    case "room_deleted":
    case "server_shutdown":
    case "participant_removed":
      return AVATAR_CLOSE_REASON.SERVER_CLOSED;
    case "unknown":
      return AVATAR_CLOSE_REASON.ERROR;
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
 * Note that a closed session is spoken to no further, because the SDK warns
 * on the console for every chunk sent to a room it has left, and a running
 * feed sends twenty-five a second.
 */
const whileOpen = (
  closed: Deferred.Deferred<AvatarCloseReason>,
  speak: Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.suspend(() => (Deferred.isDoneUnsafe(closed) ? Effect.void : speak));

/**
 * Opens the avatar for a grant: creates the session with its callbacks
 * bridged, registers its close with the scope before connecting, so a
 * connect that fails halfway still leaves the room, and answers once the
 * room is joined. The tracks arrive after; a close before either arrives
 * fails the wait on it rather than leaving it standing, and so does a
 * close of the scope whose `close()` fails without the SDK's report.
 */
export const openAvatarSession = /* @__PURE__ */ Effect.fn("desktop/openAvatarSession")(function* (
  grant: AvatarGrant,
  module: AvatarSessionModule,
): Effect.fn.Return<AvatarSession, AvatarSessionError, Scope.Scope> {
  const video = Deferred.makeUnsafe<MediaStreamTrack, AvatarSessionError>();
  const audio = Deferred.makeUnsafe<MediaStreamTrack, AvatarSessionError>();
  const closed = Deferred.makeUnsafe<AvatarCloseReason>();
  const playback = yield* Queue.unbounded<boolean, Cause.Done>();
  // The first close settles every wait; a later one changes nothing.
  const settle = (reason: AvatarCloseReason) => {
    const gone = Exit.fail(new AvatarSessionError({ failure: AVATAR_SESSION_FAILURE.CLOSED }));
    Deferred.doneUnsafe(video, gone);
    Deferred.doneUnsafe(audio, gone);
    Deferred.doneUnsafe(closed, Exit.succeed(reason));
    Queue.endUnsafe(playback);
  };
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
          onClose: (reason) => settle(closeReasonOf(reason)),
        }),
      catch: failure(AVATAR_SESSION_FAILURE.CONNECT),
    }),
    // Note that a close that fails reports nothing, so it settles the waits itself.
    (session) =>
      Effect.tryPromise(() => session.close()).pipe(
        Effect.catch(() => Effect.sync(() => settle(AVATAR_CLOSE_REASON.ERROR))),
      ),
  );
  yield* Effect.tryPromise({
    try: () => session.connect(),
    catch: failure(AVATAR_SESSION_FAILURE.CONNECT),
  });
  return {
    video: Deferred.await(video),
    audio: Deferred.await(audio),
    sendAudio: (pcm) =>
      whileOpen(
        closed,
        Effect.sync(() => session.sendAudio(pcm)),
      ),
    endTurn: whileOpen(
      closed,
      quietly(() => session.endAudioTurn()),
    ),
    interrupt: whileOpen(
      closed,
      quietly(() => session.interrupt()),
    ),
    speaking: Stream.make(false).pipe(Stream.concat(Stream.fromQueue(playback)), Stream.changes),
    closed: Deferred.await(closed),
  } satisfies AvatarSession;
});
