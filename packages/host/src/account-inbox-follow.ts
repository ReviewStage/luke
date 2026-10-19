import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import {
  type AccountInboxLiveAnswer,
  type AccountInboxLiveRows,
  accountInboxLiveRowSchemas,
  accountInboxOfLiveRows,
  nextFailedRunExpiry,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import { Cause, Data, Duration, Effect, Option, Queue, Schema, Stream } from "effect";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over Neon Realtime as Neon's guide says to.
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
 * A seal the service did not answer is asked for again, and a subscription
 * that stops for good started again, after `LIVE_RESTART`.
 */

/** How long before a sealed statement expires it is renewed, as Neon's own bindings renew it. */
const RENEW_EARLY = Duration.seconds(10);
/** How soon a renewal whose fetch failed is asked again, as Neon's own bindings ask. */
const RENEW_RETRY = Duration.seconds(1);
/** How long after a seal went unanswered, or a subscription stopped for good, it is asked again. */
const LIVE_RESTART = Duration.seconds(5);

/** How often a follower holding no failed run looks again for one to age out, since one may arrive meanwhile. */
const EXPIRY_RECHECK = Duration.hours(1);

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

/**
 * Realtime's own client, at the address the service named, loaded only when
 * the account is first followed, so its protocol's validators stay out of the
 * web app's first load.
 */
export const openRealtimeClient = (url: string): Promise<LiveClient> =>
  import("@neon/realtime/client").then(({ createRealtimeClient }) => createRealtimeClient({ url }));

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
        Effect.tryPromise({
          try: async () => dependencies.openLive(first.url),
          catch: () => new LiveBroken({ reason: "Realtime's client did not load" }),
        }),
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
      // A failed run ages out of the last week with no row moving, so the answer is published again as it does.
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.suspend(() => {
            const now = dependencies.now();
            const next =
              rows.failedRuns === undefined ? undefined : nextFailedRunExpiry(rows.failedRuns, now);
            return next === undefined
              ? Effect.sleep(EXPIRY_RECHECK)
              : Effect.andThen(Effect.sleep(Duration.millis(next - now + 1)), Effect.sync(changed));
          }),
        ),
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

/**
 * What waits across the account, followed live until interrupted.
 */
export function followAccountInbox(
  dependencies: AccountInboxFollowDependencies,
): Effect.Effect<never> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live();
    if ("failure" in sealed) return yield* Effect.sleep(LIVE_RESTART);
    yield* Stream.runForEach(liveAnswers(dependencies, sealed), (answer) =>
      Effect.sync(() => dependencies.publish(answer)),
    ).pipe(Effect.catch(() => Effect.sleep(LIVE_RESTART)));
  });
  return Effect.forever(attempt);
}
