import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import type { CodingAgentAccountInboxAnswerView } from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START } from "@luke/features/inbox-wire";
import {
  type AccountInboxLiveAnswer,
  accountInboxLiveRowSchemas,
  accountInboxOfLiveRows,
} from "@luke/features/live-wire";
import { Duration, Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over Neon Realtime as Neon's guide says to, or held open where the service has no Realtime.
 *
 * The sealed statements are fetched from the service ("Fetch from an API
 * endpoint") and followed (`live-follow.ts`); every part's rows are decoded
 * where they arrive, and each change publishes the account inbox's answer
 * whole, as the held read answered it. The sealed statements stay here,
 * where the account's own bearer is: only the answer built from the rows is
 * published.
 *
 * A service that answers no sealed statements, an older one or one whose
 * deployment has no Realtime, is read as before: one held read after
 * another, asking again for the live read every `LIVE_RETRY`. A
 * subscription that stops for good is started again after `LIVE_RESTART`.
 */

/** How long the held read stands in before the live read is asked for again. */
const LIVE_RETRY = Duration.minutes(5);
/** How long after a subscription stopped for good it is started again. */
const LIVE_RESTART = Duration.seconds(5);
/** How long a held read that went unanswered rests before it asks again. */
const HELD_REST = Duration.seconds(30);

export interface AccountInboxFollowDependencies {
  /** The sealed statements, fetched from the service; a failure where it answered none. */
  readonly live: () => Effect.Effect<AccountInboxLiveAnswer | { readonly failure: string }>;
  /** The held read past a cursor, as the service answered it before Realtime. */
  readonly held: (after: string) => Effect.Effect<CodingAgentAccountInboxAnswerView>;
  readonly openLive: (url: string) => LiveClient;
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
});

/**
 * The answers the live rows make, for as long as the subscriptions stand:
 * each part's rows decoded as they arrive. It fails where a subscription
 * stops for good or a row does not decode.
 */
function liveAnswers(
  dependencies: AccountInboxFollowDependencies,
  first: AccountInboxLiveAnswer,
): Stream.Stream<AccountInboxAnswer, LiveBroken> {
  const decode = Schema.decodeUnknownOption(LiveRowsSchema);
  return liveRows(
    { openLive: dependencies.openLive, reseal: dependencies.live, now: dependencies.now },
    first,
  ).pipe(
    Stream.mapEffect((rows) =>
      Option.match(decode(rows), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: (read) => Effect.succeed(accountInboxOfLiveRows(read, dependencies.now())),
      }),
    ),
  );
}

/** The held read, one after another from the start, for as long as `span` lasts. */
function heldFor(
  dependencies: AccountInboxFollowDependencies,
  span: Duration.Duration,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    let cursor = INBOX_CURSOR_START;
    const look = Effect.gen(function* () {
      const answer = yield* dependencies.held(cursor);
      if ("failure" in answer) return yield* Effect.sleep(HELD_REST);
      cursor = answer.cursor;
      dependencies.publish(answer);
    });
    return Effect.forever(look).pipe(Effect.timeoutOption(span), Effect.asVoid);
  });
}

/**
 * What waits across the account, followed until interrupted: live where
 * the service seals the account inbox, held where it does not.
 */
export function followAccountInbox(
  dependencies: AccountInboxFollowDependencies,
): Effect.Effect<never> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live();
    if ("failure" in sealed) return yield* heldFor(dependencies, LIVE_RETRY);
    yield* Stream.runForEach(liveAnswers(dependencies, sealed), (answer) =>
      Effect.sync(() => dependencies.publish(answer)),
    ).pipe(Effect.catch(() => Effect.sleep(LIVE_RESTART)));
  });
  return Effect.forever(attempt);
}
