/**
 * avatar-room-feed.ts -- the call window's avatar room, from main's one-shot channel to the tracks the tile plays.
 *
 * Main hands the call window the room the face is in, or none once it is
 * down, on a channel no other window hears (`onAvatarRoom`). This feed joins
 * each room it is handed through `joinAvatarRoom` and leaves it for the next,
 * or for none, so at most one room stands; it answers the tracks while the
 * room stands and none before it is joined, after it is lost, or where it
 * could not be joined. The tile's status is not decided here: it is the
 * document's, and the one thing this feed tells main is that the first frame
 * has drawn. Nothing it answers or reports carries the token.
 */

import { Effect, Queue, Stream } from "effect";
import type { CallAvatarRoom } from "#shared/messages/avatar-room";
import type { AvatarRoomConnection } from "../avatar-room/contract";
import { type AvatarRoomError, joinAvatarRoom } from "../avatar-room/join-avatar-room";

/** The avatar's two tracks while its room stands. */
export interface AvatarTracks {
  readonly video: MediaStreamTrack;
  readonly audio: MediaStreamTrack;
}

/** The bridge as the feed reads it: main's deliveries, and the ask for the room standing now. */
export interface AvatarRoomSource {
  subscribe: (onDelivered: (room: CallAvatarRoom | undefined) => void) => () => void;
  request: () => void;
}

export interface AvatarRoomFeedOptions {
  /** Tells main the face's first frame has drawn. */
  reportFirstFrame: Effect.Effect<void>;
  /** The room's maker, the avatar room bundle's by default, so a test stands a fake room in. */
  createRoom?: Effect.Effect<AvatarRoomConnection, AvatarRoomError>;
}

/**
 * Every room main hands this window, the subscription installed before the
 * ask, so the answer to the ask lands on a listener and a room handed between
 * the two is not lost.
 */
const deliveries = (source: AvatarRoomSource): Stream.Stream<CallAvatarRoom | undefined> =>
  Stream.callback<CallAvatarRoom | undefined>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => source.subscribe((room) => Queue.offerUnsafe(queue, room))),
        (stop) => Effect.sync(stop),
      );
      yield* Effect.sync(() => source.request());
    }),
  );

/**
 * One room: joined, its tracks answered once both are published and its first
 * frame reported once it draws, and nothing answered once it is lost. The room
 * is left when this stream is let go, which is when main hands another or none.
 */
const joined = (room: CallAvatarRoom, options: AvatarRoomFeedOptions) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const joinedRoom = yield* joinAvatarRoom(
        { url: room.livekitUrl, token: room.viewerToken },
        options.createRoom,
      );
      yield* Effect.forkScoped(Effect.andThen(joinedRoom.firstFrame, options.reportFirstFrame));
      const tracks: AvatarTracks = { video: joinedRoom.video, audio: joinedRoom.audio };
      return Stream.concat(
        Stream.succeed<AvatarTracks | undefined>(tracks),
        Stream.fromEffect(Effect.as(joinedRoom.lost, undefined)),
      );
    }),
  ).pipe(
    // Note that a room that could not be joined answers no tracks rather than
    // ending the feed, because the next room main hands must still be joined.
    Stream.catch(() => Stream.succeed(undefined)),
  );

/**
 * The tracks the tile plays: none until a room is handed and joined, then the
 * avatar's, then none again once that room is lost or main hands another.
 */
export const avatarRoomFeed = (
  source: AvatarRoomSource,
  options: AvatarRoomFeedOptions,
): Stream.Stream<AvatarTracks | undefined> =>
  deliveries(source).pipe(
    Stream.switchMap((room) =>
      room === undefined
        ? Stream.succeed(undefined)
        : Stream.concat(Stream.succeed(undefined), joined(room, options)),
    ),
  );
