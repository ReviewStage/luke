import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Cause, Data, Duration, Effect, Queue, Stream } from "effect";

/**
 * live-follow.ts -- a read the host follows over Neon Realtime, as Neon's guide says to: sealed statements subscribed to at the address the service names, and renewed before they expire.
 *
 * Each read is one or more parts, one sealed statement each, all on one
 * socket ("Subscribe to the sealed query"). Once every part has its first
 * result, every change of any part is the parts' rows whole, undecoded, for
 * the caller to decode at this boundary. Every seal is renewed ten seconds
 * before the earliest expires, a fetch that failed asked again a second
 * later, as Neon's own bindings renew ("Renew the sealed query"). The sealed
 * statements stay here, where the account's own bearer is; only what the
 * caller builds from the rows leaves.
 *
 * Where the service has no Realtime it answers `LIVE_POLL_URL` with each
 * statement's rows inline, and the read polls instead: the same client
 * shape hands those rows on (`pollingClient`), and the read is sealed again
 * every `LIVE_POLL_EVERY` rather than before an expiry.
 */

/** How long before a sealed statement expires it is renewed, as Neon's own bindings renew it. */
const RENEW_EARLY = Duration.seconds(10);
/** How soon a renewal whose fetch failed is asked again, as Neon's own bindings ask. */
const RENEW_RETRY = Duration.seconds(1);
/** How often a read the service answered at `LIVE_POLL_URL` is sealed again, which is how often it polls. */
const LIVE_POLL_EVERY = Duration.seconds(3);

/** A subscription that stopped for good: Realtime's client did not load, Realtime said so, a renewal was refused, or a row did not decode. */
export class LiveBroken extends Data.TaggedError("LiveBroken")<{ readonly reason: string }> {}

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

/** One snapshot of a part, as Realtime's client reports it. */
type LiveSnapshot = Parameters<Parameters<LiveSubscription["onChange"]>[0]>[0];

/**
 * The client where the service polls: each part's rows are the ones its
 * seal carried, handed on as each listener joins and again as each renewal
 * brings rows that differ from the last, so an unchanged poll is no change.
 */
function pollingClient(): LiveClient {
  return {
    subscribe: (query) => {
      let rows = query.rows;
      let said = JSON.stringify(rows);
      const listeners = new Set<(snapshot: LiveSnapshot) => void>();
      return {
        onChange: (listener) => {
          listeners.add(listener);
          listener({ status: "ready", data: rows });
          return () => void listeners.delete(listener);
        },
        renew: (renewed) => {
          const saying = JSON.stringify(renewed.rows);
          if (saying !== said) {
            rows = renewed.rows;
            said = saying;
            for (const listener of listeners) listener({ status: "ready", data: rows });
          }
          return Promise.resolve();
        },
        unsubscribe: () => listeners.clear(),
      };
    },
    close: () => undefined,
  };
}

/**
 * Realtime's own client at the address the service named, loaded only when
 * a read is first followed, so its protocol's validators stay out of the
 * web app's first load; or the polling one where it named `LIVE_POLL_URL`.
 */
export const openRealtimeClient = (url: string): Promise<LiveClient> =>
  url === LIVE_POLL_URL
    ? Promise.resolve(pollingClient())
    : import("@neon/realtime/client").then(({ createRealtimeClient }) =>
        createRealtimeClient({ url }),
      );

/** A read sealed for following: where to subscribe, and each part's sealed statement. */
export interface SealedRead<Part extends string> {
  readonly url: string;
  readonly queries: Readonly<Record<Part, SealedLiveQueryWire>>;
}

export interface LiveFollowDependencies<Part extends string> {
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** The read sealed again, for renewing; a failure where the service answered none. */
  readonly reseal: () => Effect.Effect<SealedRead<Part> | { readonly failure: string }>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
}

/** The earliest any of the read's sealed statements expires, in epoch milliseconds. */
function earliestExpiry<Part extends string>(read: SealedRead<Part>): number {
  return Math.min(
    ...Object.values<SealedLiveQueryWire>(read.queries).map((query) => query.expiresAt),
  );
}

/** How long until the read is sealed again: the poll's own beat where it polls, and otherwise just before the earliest seal expires. */
function untilRenewal<Part extends string>(read: SealedRead<Part>, now: number): Duration.Duration {
  if (read.url === LIVE_POLL_URL) return LIVE_POLL_EVERY;
  return Duration.millis(Math.max(0, earliestExpiry(read) - Duration.toMillis(RENEW_EARLY) - now));
}

/**
 * Every part's rows, whole and undecoded, each time any part changes once
 * every part has its first result, for as long as the subscriptions stand.
 * It fails where a subscription stops for good or a renewal is refused.
 */
export function liveRows<Part extends string>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
): Stream.Stream<Readonly<Record<Part, readonly unknown[]>>, LiveBroken> {
  const parts = Object.keys(first.queries).filter((part): part is Part => part in first.queries);
  return Stream.callback<Readonly<Record<Part, readonly unknown[]>>, LiveBroken>((queue) =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => dependencies.openLive(first.url),
          catch: () => new LiveBroken({ reason: "Realtime's client did not load" }),
        }),
        (opened) => Effect.sync(() => opened.close()),
      );
      const rows = new Map<Part, readonly unknown[]>();
      const broken = (reason: string) =>
        Queue.failCauseUnsafe(queue, Cause.fail(new LiveBroken({ reason })));
      const subscriptions = yield* Effect.acquireRelease(
        Effect.sync(() =>
          parts.map((part) => {
            const subscription = client.subscribe(first.queries[part]);
            subscription.onChange((snapshot) => {
              if (snapshot.status === "error") {
                broken("the subscription stopped");
                return;
              }
              if (snapshot.data === undefined) return;
              rows.set(part, snapshot.data);
              if (rows.size < parts.length) return;
              const whole = Object.fromEntries(rows);
              // SAFETY: `rows` holds every part once its size is the parts', and only parts.
              Queue.offerUnsafe(queue, whole as Readonly<Record<Part, readonly unknown[]>>);
            });
            return [part, subscription] as const;
          }),
        ),
        (standing) =>
          Effect.sync(() => {
            for (const [, subscription] of standing) subscription.unsubscribe();
          }),
      );
      let latest: SealedRead<Part> = first;
      const renewal = Effect.gen(function* () {
        yield* Effect.sleep(untilRenewal(latest, dependencies.now()));
        let next = yield* dependencies.reseal();
        while ("failure" in next) {
          yield* Effect.sleep(RENEW_RETRY);
          next = yield* dependencies.reseal();
        }
        const renewed = next;
        yield* Effect.forEach(
          subscriptions,
          ([part, subscription]) =>
            Effect.tryPromise({
              try: () => subscription.renew(renewed.queries[part]),
              catch: () => new LiveBroken({ reason: "a renewal was refused" }),
            }),
          { discard: true },
        );
        latest = renewed;
      });
      yield* Effect.forkScoped(
        Effect.forever(renewal).pipe(
          Effect.catch((failure) => Effect.sync(() => broken(failure.reason))),
        ),
      );
    }),
  );
}
