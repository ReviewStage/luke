import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import type { CodingAgentAccountInboxAnswerView } from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START } from "@luke/features/inbox-wire";
import {
  type AccountInboxLiveAnswer,
  type AccountInboxLiveRows,
  accountInboxLiveRowSchemas,
  accountInboxOfLiveRows,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import { createRealtimeClient } from "@neon/realtime/client";
import { Cause, Data, Duration, Effect, Option, Queue, Schema, Stream } from "effect";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over Neon Realtime as Neon's guide says to, or held open where the service has no Realtime.
 *
 * The sealed statements are fetched from the service ("Fetch from an API
 * endpoint"), subscribed to at the address the answer names ("Subscribe to
 * the sealed query"), and renewed ten seconds before they expire, a failed
 * fetch asked again a second later ("Renew the sealed query"). Every part's
 * rows are decoded where they arrive, and once every part has its first
 * result each change publishes the account inbox's answer whole, as the held
 * read answered it. The sealed statements stay here, where the account's own
 * bearer is: only the answer built from the rows is published.
 *
 * A service that answers no sealed statements, an older one or one whose
 * deployment has no Realtime, is read as before: one held read after
 * another, asking again for the live read every `LIVE_RETRY`. A
 * subscription that stops for good is started again after `LIVE_RESTART`.
 */

/** How long before a sealed statement expires it is renewed, as Neon's own bindings renew it. */
const RENEW_EARLY = Duration.seconds(10);
/** How soon a renewal whose fetch failed is asked again, as Neon's own bindings ask. */
const RENEW_RETRY = Duration.seconds(1);
/** How long the held read stands in before the live read is asked for again. */
const LIVE_RETRY = Duration.minutes(5);
/** How long after a subscription stopped for good it is started again. */
const LIVE_RESTART = Duration.seconds(5);
/** How long a held read that went unanswered rests before it asks again. */
const HELD_REST = Duration.seconds(30);

/** A subscription that stopped for good: Realtime said so, or a row did not decode. */
class LiveBroken extends Data.TaggedError("LiveBroken")<{ readonly reason: string }> {}

/** One part's subscription, the slice of Realtime's client this reads. */
interface LiveSubscription {
  onChange(
    listener: (snapshot: {
      readonly status: string;
      readonly data: readonly unknown[] | undefined;
    }) => void,
  ): () => void;
  renew(query: SealedLiveQueryWire): Promise<void>;
  unsubscribe(): void;
}

/** One socket to Realtime, every part's subscription on it. */
export interface LiveClient {
  subscribe(query: SealedLiveQueryWire): LiveSubscription;
  close(): void;
}

/** Realtime's own client, at the address the service named. */
export const openRealtimeClient = (url: string): LiveClient => createRealtimeClient({ url });

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

/** The earliest any of the answer's sealed statements expires, in epoch milliseconds. */
function earliestExpiry(answer: AccountInboxLiveAnswer): number {
  return Math.min(...Object.values(answer.queries).map((query) => query.expiresAt));
}

/** The rows as every part last delivered them, or nothing before each has its first result. */
interface PartRows {
  items?: AccountInboxLiveRows["items"];
  planless?: AccountInboxLiveRows["planless"];
  plans?: AccountInboxLiveRows["plans"];
  automations?: AccountInboxLiveRows["automations"];
  failedRuns?: AccountInboxLiveRows["failedRuns"];
  chatAsks?: AccountInboxLiveRows["chatAsks"];
  chatNotices?: AccountInboxLiveRows["chatNotices"];
}

function whole(rows: PartRows): Option.Option<AccountInboxLiveRows> {
  const { items, planless, plans, automations, failedRuns, chatAsks, chatNotices } = rows;
  return items && planless && plans && automations && failedRuns && chatAsks && chatNotices
    ? Option.some({ items, planless, plans, automations, failedRuns, chatAsks, chatNotices })
    : Option.none();
}

/**
 * The answers the live rows make, for as long as the subscriptions stand:
 * each part subscribed to, its rows decoded as they arrive, and every seal
 * renewed before it expires. It fails where a subscription stops for good.
 */
function liveAnswers(
  dependencies: AccountInboxFollowDependencies,
  first: AccountInboxLiveAnswer,
): Stream.Stream<AccountInboxAnswer, LiveBroken> {
  return Stream.callback<AccountInboxAnswer, LiveBroken>((queue) =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => dependencies.openLive(first.url)),
        (opened) => Effect.sync(() => opened.close()),
      );
      const rows: PartRows = {};
      const broken = (reason: string) =>
        Queue.failCauseUnsafe(queue, Cause.fail(new LiveBroken({ reason })));
      const changed = () => {
        const read = whole(rows);
        if (Option.isSome(read))
          Queue.offerUnsafe(queue, accountInboxOfLiveRows(read.value, dependencies.now()));
      };
      /** One part followed: its rows decoded as they arrive and kept under its key. */
      const follow = <Row, Encoded>(
        query: SealedLiveQueryWire,
        schema: Schema.Codec<Row, Encoded>,
        keep: (decoded: readonly Row[]) => void,
      ): LiveSubscription => {
        const subscription = client.subscribe(query);
        const decode = Schema.decodeUnknownOption(Schema.Array(schema));
        subscription.onChange((snapshot) => {
          if (snapshot.status === "error") {
            broken("the subscription stopped");
            return;
          }
          if (snapshot.data === undefined) return;
          const decoded = decode(snapshot.data);
          if (Option.isNone(decoded)) {
            broken("a row did not decode");
            return;
          }
          keep(decoded.value);
          changed();
        });
        return subscription;
      };
      const subscriptions = yield* Effect.acquireRelease(
        Effect.sync(() => ({
          items: follow(first.queries.items, accountInboxLiveRowSchemas.items, (read) => {
            rows.items = read;
          }),
          planless: follow(first.queries.planless, accountInboxLiveRowSchemas.planless, (read) => {
            rows.planless = read;
          }),
          plans: follow(first.queries.plans, accountInboxLiveRowSchemas.plans, (read) => {
            rows.plans = read;
          }),
          automations: follow(
            first.queries.automations,
            accountInboxLiveRowSchemas.automations,
            (read) => {
              rows.automations = read;
            },
          ),
          failedRuns: follow(
            first.queries.failedRuns,
            accountInboxLiveRowSchemas.failedRuns,
            (read) => {
              rows.failedRuns = read;
            },
          ),
          chatAsks: follow(first.queries.chatAsks, accountInboxLiveRowSchemas.chatAsks, (read) => {
            rows.chatAsks = read;
          }),
          chatNotices: follow(
            first.queries.chatNotices,
            accountInboxLiveRowSchemas.chatNotices,
            (read) => {
              rows.chatNotices = read;
            },
          ),
        })),
        (standing) =>
          Effect.sync(() => {
            for (const subscription of Object.values(standing)) subscription.unsubscribe();
          }),
      );
      let expiresAt = earliestExpiry(first);
      const renewal = Effect.gen(function* () {
        const wait = expiresAt - Duration.toMillis(RENEW_EARLY) - dependencies.now();
        yield* Effect.sleep(Duration.millis(Math.max(0, wait)));
        let next = yield* dependencies.live();
        while ("failure" in next) {
          yield* Effect.sleep(RENEW_RETRY);
          next = yield* dependencies.live();
        }
        const renewed = next;
        yield* Effect.forEach(
          [
            "items",
            "planless",
            "plans",
            "automations",
            "failedRuns",
            "chatAsks",
            "chatNotices",
          ] as const,
          (part) =>
            Effect.tryPromise({
              try: () => subscriptions[part].renew(renewed.queries[part]),
              catch: () => new LiveBroken({ reason: "a renewal was refused" }),
            }),
          { discard: true },
        );
        expiresAt = earliestExpiry(renewed);
      });
      yield* Effect.forkScoped(
        Effect.forever(renewal).pipe(
          Effect.catch((failure) => Effect.sync(() => broken(failure.reason))),
        ),
      );
    }),
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
