import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import {
  type AccountInboxLiveAnswer,
  type AccountInboxLiveRows,
  accountInboxLiveRowSchemas,
  accountInboxOfLiveRows,
  LIVE_SIGNED_OUT,
  nextFailedRunExpiry,
} from "@luke/features/live-wire";
import { Duration, Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, type LiveSignedOut, liveRows } from "./live-follow.js";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over Neon Realtime as Neon's guide says to.
 *
 * The sealed statements are fetched from the service ("Fetch from an API
 * endpoint") and followed (`live-follow.ts`); every part's rows are decoded
 * where they arrive, and each change publishes the account inbox's answer
 * whole, as the held read answered it, and again as a failed run ages out
 * of the last week with no row moving. The sealed statements stay here,
 * where the account's own bearer is: only the answer built from the rows is
 * published.
 *
 * A seal the service did not answer is asked for again, and a subscription
 * that stops for good started again, after `LIVE_RESTART`. A seal or a
 * renewal refused as signed out is never asked again, as Neon's guide says
 * ("When the session changes"): the follow waits to be let go, which a
 * sign-out or another account's sign-in does.
 */

/** How long after a seal went unanswered, or a subscription stopped for good, it is asked again. */
const LIVE_RESTART = Duration.seconds(5);

export interface AccountInboxFollowDependencies {
  /** The sealed statements, fetched from the service; a failure where it answered none. */
  readonly live: () => Effect.Effect<AccountInboxLiveAnswer | { readonly failure: string }>;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock: when an answer was read, and how far back a failed run is still told. */
  readonly now: () => number;
  /** The answer, each time it changes. */
  readonly publish: (answer: AccountInboxAnswer) => void;
}

/** Every part's rows as the desktop decodes them, at this boundary. */
const LiveRowsSchema = Schema.Struct({
  items: Schema.Array(accountInboxLiveRowSchemas.items),
  planless: Schema.Array(accountInboxLiveRowSchemas.planless),
  plans: Schema.Array(accountInboxLiveRowSchemas.plans),
  automations: Schema.Array(accountInboxLiveRowSchemas.automations),
  failedRuns: Schema.Array(accountInboxLiveRowSchemas.failedRuns),
  chatAsks: Schema.Array(accountInboxLiveRowSchemas.chatAsks),
  chatNotices: Schema.Array(accountInboxLiveRowSchemas.chatNotices),
});

/**
 * The answers one delivery of rows makes: the answer now, then again each
 * time one of its failed runs ages out of the last week, until the next
 * delivery takes its place.
 */
function answersOf(
  dependencies: AccountInboxFollowDependencies,
  read: AccountInboxLiveRows,
): Stream.Stream<AccountInboxAnswer> {
  const answer = () => accountInboxOfLiveRows(read, dependencies.now());
  return Stream.unfold(true, (first) => {
    if (first) return Effect.succeed([answer(), false] as const);
    const now = dependencies.now();
    const next = nextFailedRunExpiry(read.failedRuns, now);
    return next === undefined
      ? Effect.succeed(undefined)
      : Effect.andThen(
          Effect.sleep(Duration.millis(next - now + 1)),
          Effect.sync(() => [answer(), false] as const),
        );
  });
}

/**
 * The answers the live rows make, for as long as the subscriptions stand:
 * each part's rows decoded as they arrive. It fails where a subscription
 * stops for good or a row does not decode.
 */
function liveAnswers(
  dependencies: AccountInboxFollowDependencies,
  first: AccountInboxLiveAnswer,
): Stream.Stream<AccountInboxAnswer, LiveBroken | LiveSignedOut> {
  const decode = Schema.decodeUnknownOption(LiveRowsSchema);
  return liveRows(
    { openLive: dependencies.openLive, reseal: dependencies.live, now: dependencies.now },
    first,
  ).pipe(
    Stream.mapEffect((rows) =>
      Option.match(decode(rows), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: (read) => Effect.succeed(read),
      }),
    ),
    Stream.switchMap((read) => answersOf(dependencies, read)),
  );
}

/**
 * What waits across the account, followed live until interrupted.
 */
export function followAccountInbox(
  dependencies: AccountInboxFollowDependencies,
): Effect.Effect<never> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live();
    if ("failure" in sealed) {
      if (sealed.failure === LIVE_SIGNED_OUT.failure) return yield* Effect.never;
      return yield* Effect.sleep(LIVE_RESTART);
    }
    yield* Stream.runForEach(liveAnswers(dependencies, sealed), (answer) =>
      Effect.sync(() => dependencies.publish(answer)),
    ).pipe(
      Effect.catchTag("LiveSignedOut", () => Effect.never),
      Effect.catch(() => Effect.sleep(LIVE_RESTART)),
    );
  });
  return Effect.forever(attempt);
}
