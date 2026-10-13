/**
 * join-avatar-room.ts -- the call window's view of the avatar: joins LiveAvatar's LiveKit room on the viewer token and hands back the avatar's two tracks, when its first frame lands, and when the room is gone.
 *
 * The room is acquired into the caller's `Scope` rather than handed over to
 * be left by hand: the room is left when that scope closes, which is the one
 * end a call's video has. Its handlers are cleared before it is left, so
 * leaving on purpose never reads as the room being lost.
 *
 * The join answers once the avatar has published both its video and its
 * audio, under a bound, since a room whose avatar never publishes would
 * otherwise hold the tile on "connecting" for good. A track published before
 * the join settled fires no subscription event, so the room's standing tracks
 * are read once it has joined, as LiveAvatar's reference app does.
 *
 * Neither the token nor anything LiveKit threw rides an `AvatarRoomError`:
 * the failure is named by what went wrong and nothing more, since a LiveKit
 * error may quote the request that carried the token.
 */

import { Data, Deferred, Duration, Effect, Exit, type Scope } from "effect";
import { appendBundle } from "../bundle-loader";
import { AVATAR_ROOM_ASSET, type AvatarRoomConnection } from "./contract";

/** How long the avatar may take to publish both its tracks once the room is joined. */
export const AVATAR_TRACKS_TIMEOUT_MS = 20_000;

const TRACK_KIND = { VIDEO: "video", AUDIO: "audio" } as const;

/** The unmute a remote track fires once its first media arrives. */
const TRACK_UNMUTE = "unmute";

export const AVATAR_ROOM_FAILURE = {
  /** The avatar room bundle did not load, or loaded without its room. */
  UNLOADED: "unloaded",
  /** The room refused the join: a bad or spent token, or no server at the URL. */
  REFUSED: "refused",
  /** The avatar published no video and audio within the bound. */
  NO_TRACKS: "no-tracks",
  /** The room went away before the avatar published both tracks. */
  LOST: "lost",
} as const;

export type AvatarRoomFailure = (typeof AVATAR_ROOM_FAILURE)[keyof typeof AVATAR_ROOM_FAILURE];

export class AvatarRoomError extends Data.TaggedError("AvatarRoomError")<{
  readonly failure: AvatarRoomFailure;
}> {}

/** Where the room is and the viewer token that joins it, as the voice service's `avatar.started` gave them. */
export interface AvatarRoomGrant {
  readonly url: string;
  readonly token: string;
}

/** The avatar as the call window shows it. */
export interface AvatarRoom {
  readonly video: MediaStreamTrack;
  readonly audio: MediaStreamTrack;
  /** Settles once the video's first media has arrived, at once where it already has. */
  readonly firstFrame: Effect.Effect<void>;
  /** Settles once the room is gone from under the call; never for the scope's own leaving. */
  readonly lost: Effect.Effect<void>;
}

interface AvatarTracks {
  video?: MediaStreamTrack;
  audio?: MediaStreamTrack;
}

const failWith = (failure: AvatarRoomFailure) => Effect.fail(new AvatarRoomError({ failure }));

/**
 * The room LiveKit makes, from the avatar room bundle, which is loaded into
 * the window the first time a call asks for it and kept for the window's life.
 */
const createBundledRoom: Effect.Effect<AvatarRoomConnection, AvatarRoomError> = Effect.callback(
  (resume) => {
    const made = () => {
      const module = window.lukeAvatarRoom;
      resume(
        module
          ? Effect.try({
              try: () => module.createRoom(),
              catch: () => new AvatarRoomError({ failure: AVATAR_ROOM_FAILURE.UNLOADED }),
            })
          : failWith(AVATAR_ROOM_FAILURE.UNLOADED),
      );
    };
    if (window.lukeAvatarRoom !== undefined) return made();
    appendBundle({ script: AVATAR_ROOM_ASSET.SCRIPT }, made, () =>
      resume(failWith(AVATAR_ROOM_FAILURE.UNLOADED)),
    );
  },
);

/** Waits for a track's first media, or answers at once where it has already arrived. */
const awaitFirstMedia = (track: MediaStreamTrack): Effect.Effect<void> =>
  Effect.suspend(() =>
    track.muted
      ? Effect.callback<void>((resume) => {
          const unmuted = () => resume(Effect.void);
          track.addEventListener(TRACK_UNMUTE, unmuted, { once: true });
          return Effect.sync(() => track.removeEventListener(TRACK_UNMUTE, unmuted));
        })
      : Effect.void,
  );

/** The room, joined and left with the scope; leaving clears its handlers first. */
const acquireRoom = (createRoom: Effect.Effect<AvatarRoomConnection, AvatarRoomError>) =>
  Effect.acquireRelease(createRoom, (room) =>
    Effect.suspend(() => {
      room.ontrack = null;
      room.ondisconnected = null;
      return Effect.tryPromise(() => room.disconnect()).pipe(Effect.ignore);
    }),
  );

/**
 * Joins the avatar's room and answers with its tracks. The second argument is
 * the room's maker, the bundle's by default, so a test stands a fake room in.
 */
export const joinAvatarRoom = /* @__PURE__ */ Effect.fn("desktop/joinAvatarRoom")(function* (
  grant: AvatarRoomGrant,
  createRoom: Effect.Effect<AvatarRoomConnection, AvatarRoomError> = createBundledRoom,
): Effect.fn.Return<AvatarRoom, AvatarRoomError, Scope.Scope> {
  const room = yield* acquireRoom(createRoom);
  const lost = Deferred.makeUnsafe<void>();
  const published = Deferred.makeUnsafe<Required<AvatarTracks>, AvatarRoomError>();
  const tracks: AvatarTracks = {};
  // Note that the first track of each kind is the avatar's, because the room holds no other publisher.
  const take = (track: MediaStreamTrack) => {
    if (track.kind === TRACK_KIND.VIDEO) tracks.video ??= track;
    if (track.kind === TRACK_KIND.AUDIO) tracks.audio ??= track;
    const { video, audio } = tracks;
    if (video && audio) Deferred.doneUnsafe(published, Exit.succeed({ video, audio }));
  };
  room.ontrack = take;
  room.ondisconnected = () => {
    Deferred.doneUnsafe(lost, Exit.void);
    Deferred.doneUnsafe(
      published,
      Exit.fail(new AvatarRoomError({ failure: AVATAR_ROOM_FAILURE.LOST })),
    );
  };
  yield* Effect.tryPromise({
    try: () => room.connect(grant.url, grant.token),
    catch: () => new AvatarRoomError({ failure: AVATAR_ROOM_FAILURE.REFUSED }),
  });
  for (const track of room.remoteTracks()) take(track);
  const { video, audio } = yield* Deferred.await(published).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(AVATAR_TRACKS_TIMEOUT_MS),
      orElse: () => failWith(AVATAR_ROOM_FAILURE.NO_TRACKS),
    }),
  );
  return { video, audio, firstFrame: awaitFirstMedia(video), lost: Deferred.await(lost) };
});
