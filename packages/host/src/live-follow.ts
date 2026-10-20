import { LIVE_POLL_URL, liveDigestOf, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Cause, Data, Duration, Effect, Fiber, Queue, Schedule, Stream } from "effect";

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
 * Where Realtime fails the read (a subscription in error, a client that did
 * not load, or a renewal refused), the read is polled instead, and Realtime
 * is subscribed to again every `RESUBSCRIBE_EVERY`; once it delivers again,
 * the polling stops. Each switch is said in the log, never the sealed query.
 * Where the service answers the seal itself polled, Realtime being off, the
 * read is polled quietly and not subscribed to again. A poll names where
 * the rows last stood (`liveDigestOf`), the service holds it until they move
 * or a while passes, and it is asked again at once, a failed one a second
 * later and then up to five.
 */

/** How long before a sealed statement expires it is renewed, as Neon's own bindings renew it. */
const RENEW_EARLY = Duration.seconds(10);
/** How soon a renewal whose fetch failed is asked again, as Neon's own bindings ask. */
const RENEW_RETRY = Duration.seconds(1);
/** The least time between two polls, so a service answering at once is not asked in a hot loop; each poll is otherwise held by the service until the rows move. */
const LIVE_POLL_FLOOR = Duration.millis(500);
/** How a poll that failed is asked again: a second later, then longer, up to five seconds. */
const POLL_BACKOFF = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("5 seconds")]);
/** How often Realtime is subscribed to again while a read is polled. */
const RESUBSCRIBE_EVERY = Duration.seconds(15);
/** Why a read stopped for good: it names nothing the account reaches any more. */
const GONE = "the read is gone";
/** What a go at Realtime leaves to do: subscribe again later, or stay polled, the service answering polled. */
const AGAIN = "again";
const STAY = "stay";

/** A subscription that stopped for good: Realtime's client did not load, Realtime said so, a renewal was refused, or a row did not decode. */
export class LiveBroken extends Data.TaggedError("LiveBroken")<{
  readonly reason: string;
  /** Realtime's own code for why a subscription stopped, where it said one. */
  readonly code?: string;
}> {}

/** One part's subscription, the slice of Realtime's client this reads. */
interface LiveSubscription {
  onChange(
    listener: (snapshot: {
      readonly status: string;
      readonly data: readonly unknown[] | undefined;
      readonly error?: { readonly code: string } | undefined;
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
 * a read is first followed, so its protocol's validators stay out of the
 * web app's first load.
 */
export const openRealtimeClient = (url: string): Promise<LiveClient> =>
  import("@neon/realtime/client").then(({ createRealtimeClient }) => createRealtimeClient({ url }));

/** A read sealed for following: where to subscribe, and each part's sealed statement. */
export interface SealedRead<Part extends string> {
  readonly url: string;
  readonly queries: Readonly<Record<Part, SealedLiveQueryWire>>;
}

export interface LiveFollowDependencies<Part extends string> {
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /**
   * The read sealed again, for renewing; a failure where the service
   * answered none, asked again a second later, or `gone` where the read
   * names nothing the account reaches any more, which stops the follow.
   */
  readonly reseal: () => Effect.Effect<
    SealedRead<Part> | { readonly failure: string; readonly gone?: boolean }
  >;
  /**
   * The read with each part's rows inline (`LIVE_POLL_URL`), asked while
   * Realtime fails or is off, held by the service until the rows move past
   * `after` (`liveDigestOf`); a failure as `reseal`'s.
   */
  readonly poll: (
    after: string | undefined,
  ) => Effect.Effect<SealedRead<Part> | { readonly failure: string; readonly gone?: boolean }>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
}

/** The earliest any of the read's sealed statements expires, in epoch milliseconds. */
function earliestExpiry<Part extends string>(read: SealedRead<Part>): number {
  return Math.min(
    ...Object.values<SealedLiveQueryWire>(read.queries).map((query) => query.expiresAt),
  );
}

/**
 * Every part's rows over one Realtime subscription, whole and undecoded,
 * each time any part changes once every part has its first result, for as
 * long as the subscriptions stand. It fails where a subscription stops for
 * good or a renewal is refused.
 */
function realtimeRows<Part extends string>(
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
                const code = snapshot.error?.code;
                Queue.failCauseUnsafe(
                  queue,
                  Cause.fail(
                    new LiveBroken({
                      reason: "the subscription stopped",
                      ...(code === undefined ? undefined : { code }),
                    }),
                  ),
                );
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
      let expiresAt = earliestExpiry(first);
      const renewal = Effect.gen(function* () {
        const wait = expiresAt - Duration.toMillis(RENEW_EARLY) - dependencies.now();
        yield* Effect.sleep(Duration.millis(Math.max(0, wait)));
        let next = yield* dependencies.reseal();
        while ("failure" in next) {
          if (next.gone === true) {
            return yield* Effect.fail(new LiveBroken({ reason: GONE }));
          }
          yield* Effect.sleep(RENEW_RETRY);
          next = yield* dependencies.reseal();
        }
        const renewed = next;
        // A renewal the service answered polled carries no capability Realtime renews with: the read is polled instead.
        if (renewed.url === LIVE_POLL_URL) {
          return yield* Effect.fail(
            new LiveBroken({ reason: "Realtime could not seal a renewal" }),
          );
        }
        yield* Effect.forEach(
          subscriptions,
          ([part, subscription]) =>
            Effect.tryPromise({
              try: () => subscription.renew(renewed.queries[part]),
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

/** Each part's rows as a polled read carries them inline; none where a part carries none. */
function rowsOf<Part extends string>(
  parts: readonly Part[],
  read: SealedRead<Part>,
): Readonly<Record<Part, readonly unknown[]>> | undefined {
  const rows = parts.map((part) => [part, read.queries[part].rows] as const);
  if (rows.some(([, carried]) => carried === undefined)) return undefined;
  // SAFETY: every part is written above, each with its rows.
  return Object.fromEntries(rows) as Readonly<Record<Part, readonly unknown[]>>;
}

/**
 * Every part's rows, whole and undecoded, each time they change, for as
 * long as the caller reads: over Realtime while it delivers, and polled
 * while it fails (see the module's note). It fails only where the read is
 * gone.
 */
export function liveRows<Part extends string>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
): Stream.Stream<Readonly<Record<Part, readonly unknown[]>>, LiveBroken> {
  const parts = Object.keys(first.queries).filter((part): part is Part => part in first.queries);
  return Stream.callback<Readonly<Record<Part, readonly unknown[]>>, LiveBroken>((queue) =>
    Effect.gen(function* () {
      let last: string | undefined;
      const emit = (rows: Readonly<Record<Part, readonly unknown[]>>) => {
        const said = JSON.stringify(rows);
        if (said === last) return;
        last = said;
        Queue.offerUnsafe(queue, rows);
      };
      const gone = () => Queue.failCauseUnsafe(queue, Cause.fail(new LiveBroken({ reason: GONE })));

      /** Where the rows stood at the last poll, which the next is held past. */
      let seen: string | undefined;
      const pollOnce = Effect.gen(function* () {
        const read = yield* dependencies.poll(seen);
        if ("failure" in read) {
          if (read.gone === true) {
            gone();
            return yield* Effect.never;
          }
          return yield* Effect.fail(read);
        }
        seen = liveDigestOf(read.queries) ?? seen;
        const rows = rowsOf(parts, read);
        if (rows !== undefined) emit(rows);
      });
      let polling: Fiber.Fiber<never, unknown> | undefined;
      /** Polls from now on, unless it already does; `why` is said in the log where Realtime failed rather than being off. */
      const startPolling = (why: LiveBroken | undefined) =>
        Effect.gen(function* () {
          if (polling !== undefined) return;
          if (why !== undefined) {
            yield* Effect.logWarning(`live-follow: Realtime failed (${why.reason}); polling`).pipe(
              Effect.annotateLogs(why.code === undefined ? {} : { code: why.code }),
            );
          }
          polling = yield* Effect.forkScoped(
            pollOnce.pipe(
              Effect.retry(POLL_BACKOFF),
              Effect.repeat(Schedule.spaced(LIVE_POLL_FLOOR)),
              Effect.andThen(Effect.never),
            ),
          );
        });
      const stopPolling = Effect.gen(function* () {
        if (polling === undefined) return;
        yield* Fiber.interrupt(polling);
        polling = undefined;
        yield* Effect.logInfo("live-follow: Realtime is back; polling stopped");
      });

      /** The read as last sealed, the first the caller handed, then each resubscribe's. */
      let sealed: SealedRead<Part> | { readonly failure: string; readonly gone?: boolean } = first;
      /**
       * One go at Realtime: followed until it breaks, polled from then on.
       * Answers whether to subscribe again later: not where the read is gone,
       * nor where the service answered it polled, Realtime being off.
       */
      const attempt = Effect.gen(function* () {
        if ("failure" in sealed) return sealed.gone === true ? GONE : AGAIN;
        if (sealed.url === LIVE_POLL_URL) {
          const rows = rowsOf(parts, sealed);
          if (rows !== undefined) emit(rows);
          seen = liveDigestOf(sealed.queries) ?? seen;
          yield* startPolling(undefined);
          return STAY;
        }
        const broken = yield* Stream.runForEach(realtimeRows(dependencies, sealed), (rows) =>
          Effect.andThen(
            stopPolling,
            Effect.sync(() => emit(rows)),
          ),
        ).pipe(
          Effect.match({
            onFailure: (why) => why,
            onSuccess: () => new LiveBroken({ reason: "the subscription ended" }),
          }),
        );
        if (broken.reason === GONE) return GONE;
        yield* startPolling(broken);
        return AGAIN;
      });
      const resubscribe = Effect.andThen(
        Effect.flatMap(dependencies.reseal(), (next) =>
          Effect.sync(() => {
            sealed = next;
          }),
        ),
        attempt,
      );
      const follow = Effect.gen(function* () {
        let next = yield* attempt;
        if (next === AGAIN) {
          next = yield* Effect.repeat(resubscribe, {
            schedule: Schedule.spaced(RESUBSCRIBE_EVERY),
            while: (then) => then === AGAIN,
          });
        }
        if (next === GONE) gone();
      });
      yield* Effect.forkScoped(follow);
    }),
  );
}
