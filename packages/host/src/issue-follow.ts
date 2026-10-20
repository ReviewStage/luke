import {
  type IssuesLiveAnswer,
  issuesLiveRowsSchema,
  issuesOfLiveRows,
} from "@luke/features/issue-live";
import type { IssueCallFailure, IssueListView } from "@luke/features/issue-view";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import { Duration, Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows, logLiveBroken } from "./live-follow.js";

/**
 * issue-follow.ts -- a workspace's standing issues, followed over Neon Realtime for the windows that draw them.
 *
 * The sealed statement is fetched from the service and followed
 * (`live-follow.ts`); its rows are decoded where they arrive and the list is
 * built from them (`@luke/features/issue-live`) and published each time they
 * move. The sealed statement stays here, where the account's own bearer is;
 * only the list built from it is published.
 *
 * A seal the service did not answer is published as the failure it was and
 * asked for again, and a subscription that stops for good is started again,
 * each after `LIVE_RESTART`. A seal or a renewal refused as signed out, the
 * session no longer the account the follow started for, ends the follow
 * for good, as Neon's guide says to ("When the session changes"). Nothing
 * is read on a clock.
 */

/** How long after a seal went unanswered, or a subscription stopped for good, it is asked again. */
const LIVE_RESTART = Duration.seconds(5);

export interface IssueFollowDependencies {
  /** The workspace's standing issues sealed, fetched from the service; a failure where it sealed none. */
  readonly live: () => Effect.Effect<
    IssuesLiveAnswer | { readonly failure: IssueCallFailure } | typeof LIVE_SIGNED_OUT
  >;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** The list as it now stands, or why there is none, each time it moves. */
  readonly publish: (view: IssueListView) => void;
  /** Handed the wait for a write's transaction on each subscription, as it is subscribed. */
  readonly onSubscribed: (
    awaitTxId: (txid: string, timeoutMillis: number) => Promise<void>,
  ) => void;
}

/** A workspace's standing issues followed until interrupted, each change published. */
export function followIssues(dependencies: IssueFollowDependencies): Effect.Effect<never> {
  const decode = Schema.decodeUnknownOption(issuesLiveRowsSchema);
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live();
    if ("failure" in sealed) {
      if (sealed.failure === LIVE_SIGNED_OUT.failure) return yield* Effect.never;
      dependencies.publish({ failure: sealed.failure });
      return yield* Effect.sleep(LIVE_RESTART);
    }
    const rows = liveRows(
      {
        openLive: dependencies.openLive,
        reseal: dependencies.live,
        now: dependencies.now,
        onSubscribed: dependencies.onSubscribed,
      },
      sealed,
    );
    yield* Stream.runForEach(rows, (read) =>
      Option.match(decode(read), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: (decoded) =>
          Effect.sync(() => dependencies.publish({ issues: issuesOfLiveRows(decoded) })),
      }),
    ).pipe(
      Effect.catchTag("LiveSignedOut", () => Effect.never),
      Effect.catch((broken) =>
        Effect.andThen(logLiveBroken("a workspace's issues", broken), Effect.sleep(LIVE_RESTART)),
      ),
    );
  });
  return Effect.forever(attempt);
}
