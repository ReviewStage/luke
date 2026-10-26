import {
  type ChannelsLiveAnswer,
  type ChannelsLiveRows,
  channelsLiveRowsSchema,
  channelsMovedBetween,
} from "@luke/features/channel-live";
import { CHANNEL_CALL_FAILURE, type ChannelsMoved } from "@luke/features/channel-view";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import { Effect, Stream } from "effect";
import {
  decodedLiveRows,
  LIVE_GONE,
  type LiveClient,
  restarting,
  type SealedRead,
} from "./live-follow.js";

/**
 * channel-follow.ts -- a workspace's channels, followed on the service's live read for the windows that draw them, which hear the channels that moved each time any does.
 *
 * The live read is fetched from the service and followed (`live-follow.ts`):
 * held polls while Realtime is off, a subscription where it is on. Its rows
 * mark where each channel stands (`@luke/features/channel-live`), and each
 * delivery is told as the channels whose mark moved since the last, every
 * one on a seal's first, since the read the window opened with may have
 * missed what it says. The window reads the channels, and the threads of
 * one it shows, again itself; only which channels moved leaves here.
 *
 * A read the service did not answer is told as unanswered and asked for
 * again, as a follow that stops for good is started again, after
 * `LIVE_RESTART`. A workspace the account does not reach is told not found
 * and ends the follow; one refused because the session is no longer the
 * account the follow started for ends it unsaid, and the next sign-in's
 * window follows it again.
 */

/** A live read as the follow asks for it: sealed, or with `poll` its rows inline; a failure where the service answered none. */
type Sealed<Answer> = Answer | { readonly failure: string };

export interface ChannelsFollowDependencies {
  /** The workspace's channels as a live read, or with `poll` their rows inline, held past `after`. */
  readonly live: (poll: boolean, after?: string) => Effect.Effect<Sealed<ChannelsLiveAnswer>>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** What the windows following the workspace hear. */
  readonly publish: (heard: ChannelsMoved) => void;
}

/** A read with one the account no longer reaches marked gone, so its follow ends rather than asks again. */
function goneWhereNotFound(
  read: Sealed<SealedRead<"channels" | "threads">>,
): SealedRead<"channels" | "threads"> | { readonly failure: string; readonly gone: boolean } {
  return "failure" in read
    ? { failure: read.failure, gone: read.failure === CHANNEL_CALL_FAILURE.NOT_FOUND }
    : read;
}

/** The workspace's channels followed until interrupted, signed out, or no longer the account's, each move published. */
export function followChannels(dependencies: ChannelsFollowDependencies): Effect.Effect<void> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live(false);
    if ("failure" in sealed) {
      if (sealed.failure === LIVE_SIGNED_OUT.failure) return false;
      if (sealed.failure === CHANNEL_CALL_FAILURE.NOT_FOUND) {
        dependencies.publish({ failure: CHANNEL_CALL_FAILURE.NOT_FOUND });
        return false;
      }
      dependencies.publish({ failure: CHANNEL_CALL_FAILURE.UNANSWERED });
      return true;
    }
    /** Why the follow ended for good, the first renewal's or poll's terminal failure, kept whatever answers after it. */
    let endedBy: string | undefined;
    const noted = (read: Sealed<ChannelsLiveAnswer>) => {
      if (
        endedBy === undefined &&
        "failure" in read &&
        (read.failure === CHANNEL_CALL_FAILURE.NOT_FOUND ||
          read.failure === LIVE_SIGNED_OUT.failure)
      ) {
        endedBy = read.failure;
      }
      return goneWhereNotFound(read);
    };
    const rows = decodedLiveRows(
      {
        openLive: dependencies.openLive,
        reseal: () => Effect.map(dependencies.live(false), noted),
        poll: (after) => Effect.map(dependencies.live(true, after), noted),
        now: dependencies.now,
      },
      sealed,
      channelsLiveRowsSchema,
    );
    // Note that the marks start over with each seal, so its first delivery tells every channel.
    let last: ChannelsLiveRows | undefined;
    const gone = yield* Stream.runForEach(rows, (decoded) =>
      Effect.sync(() => {
        const moved = channelsMovedBetween(last, decoded);
        last = decoded;
        if (moved.length > 0) dependencies.publish({ moved });
      }),
    ).pipe(
      Effect.as(false),
      Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
    );
    if (gone) {
      if (endedBy === CHANNEL_CALL_FAILURE.NOT_FOUND) {
        dependencies.publish({ failure: CHANNEL_CALL_FAILURE.NOT_FOUND });
      }
      return false;
    }
    return true;
  });
  return restarting(attempt);
}
