import {
  LIVE_POLL_URL,
  LIVE_SIGNED_OUT,
  liveDigestOf,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import {
  Array as Arr,
  Cause,
  Context,
  Data,
  Duration,
  Effect,
  Fiber,
  Queue,
  Schedule,
  Stream,
} from "effect";

/**
 * live-follow.ts -- a read the host follows over Neon Realtime, as Neon's guide says to: sealed statements subscribed to at the address the service names, and renewed before they expire.
 *
 * Each read is one or more parts, one sealed statement each, and every read
 * at one address shares one client and its one socket ("Create one client
 * for the whole app, because every subscription shares its connection").
 * Once every part has its first
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
/**
 * Whether a failed seal ends the read for good: it names nothing the account
 * reaches any more, or the service refused the session as signed out, which
 * Neon's guide says is never asked again ("When the session changes").
 */
function ended(failed: { readonly failure: string; readonly gone?: boolean }): boolean {
  return failed.gone === true || failed.failure === LIVE_SIGNED_OUT.failure;
}

/** Why a read stopped for good: it names nothing the account reaches any more, or its session signed out. */
export const LIVE_GONE = "the read is gone";
const GONE = LIVE_GONE;
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
  /** Settles once the transaction named has arrived on the subscription, or rejects once the timeout passes, as Realtime's own does. */
  awaitTxId(txid: string, timeout?: number): Promise<void>;
  unsubscribe(): void;
}

/** How long a write waits for its transaction to reach the read that shows it, as Neon's guide says always to bound it. */
const TX_WAIT_TIMEOUT = Duration.seconds(10);

/**
 * A wait for a write's transaction to arrive on a followed read: it settles
 * once any of the read's parts has it, and fails once the timeout passes,
 * as Realtime's `awaitTxId` does.
 */
export type TxWait = (txid: string, timeout: Duration.Duration) => Effect.Effect<void, LiveBroken>;

/** One socket to Realtime, every part's subscription on it. */
export interface LiveClient {
  subscribe(query: SealedLiveQueryWire): LiveSubscription;
  close(): void;
}

/**
 * One client per address, shared by every read following there: each open
 * takes a handle, and the client closes once the last handle is let go. The
 * client is opened once however many reads wait on it while it loads; one
 * that failed to load is forgotten, so the next read loads it afresh. So is
 * one any of whose subscriptions moved to `error`: where its connection
 * failed, every subscription on it is in `error` and Neon's guide says to
 * create a new client before subscribing again, so the next read opens a
 * new one and the old one closes once its last holder lets go. `drop`
 * forgets every client the same way, for a sign-out or an account switch.
 */
export function shareLiveClients(open: (url: string) => LiveClient | PromiseLike<LiveClient>): {
  readonly open: (url: string) => Promise<LiveClient>;
  readonly drop: () => void;
} {
  interface Shared {
    readonly client: Promise<LiveClient>;
    holders: number;
  }
  const standing = new Map<string, Shared>();
  const forget = (url: string, shared: Shared) => {
    if (standing.get(url) === shared) standing.delete(url);
  };
  return {
    open: async (url) => {
      let shared = standing.get(url);
      if (shared === undefined) {
        const opening: Shared = { client: Promise.resolve(url).then(open), holders: 0 };
        opening.client.catch(() => forget(url, opening));
        standing.set(url, opening);
        shared = opening;
      }
      const held = shared;
      held.holders += 1;
      let client: LiveClient;
      try {
        client = await held.client;
      } catch (error) {
        held.holders -= 1;
        throw error;
      }
      let holding = true;
      return {
        subscribe: (query) => {
          const subscription = client.subscribe(query);
          subscription.onChange((snapshot) => {
            if (snapshot.status === "error") forget(url, held);
          });
          return subscription;
        },
        close: () => {
          if (!holding) return;
          holding = false;
          held.holders -= 1;
          if (held.holders > 0) return;
          forget(url, held);
          client.close();
        },
      };
    },
    drop: () => standing.clear(),
  };
}

const realtimeClients = shareLiveClients((url) =>
  import("@neon/realtime/client").then(({ createRealtimeClient }) => createRealtimeClient({ url })),
);

/**
 * Realtime's own client at the address the service named, shared by every
 * read following there, and loaded only when a read is first followed, so
 * its protocol's validators stay out of the web app's first load.
 */
export const openRealtimeClient = realtimeClients.open;

/** Forgets the shared Realtime clients, on a sign-out or an account switch: the next read opens a new one, and each old one closes once its reads let go. */
export const dropRealtimeClients = realtimeClients.drop;

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
  /**
   * Hears the read's wait for a write's transaction once its parts are
   * subscribed over Realtime, and none once they are let go, a polled read
   * included, which has no transaction to wait on.
   */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** The earliest any of the read's sealed statements expires, in epoch milliseconds. */
function earliestExpiry<Part extends string>(read: SealedRead<Part>): number {
  return Math.min(
    ...Object.values<SealedLiveQueryWire>(read.queries).map((query) => query.expiresAt),
  );
}

/**
 * Where a followed read's rows stand between Realtime and the caller, so a
 * write's wait settles only once the caller has the rows its transaction
 * changed, as Neon's guide has `awaitTxId` resolve after the subscription's
 * `onChange` so nothing flickers. Note that the host's caller reads the rows
 * on a fiber of its own, a hop after `onChange`, so the wait follows them:
 * Realtime's change is counted as it is offered (`changed`), handed on as the
 * caller's next rows (`handed`, or none where they did not move), and taken
 * once the caller asks for rows again (`taken`), its handling of them done.
 */
class Shown {
  /** Realtime changes offered, rows emitted to the caller, and the most the caller has finished with. */
  private changes = 0;
  private emitted = 0;
  private finished = 0;
  /** The change last handed on, and the emit each change was handed on as. */
  private handed = 0;
  private delivered = 0;
  private readonly waiting: Array<{ change: number; emit?: number; settle: () => void }> = [];

  /** A Realtime change offered, numbered for its wait. */
  changed(): number {
    this.changes += 1;
    return this.changes;
  }

  /** Rows emitted to the caller, numbered for the caller's pulls. */
  emit(): number {
    this.emitted += 1;
    return this.emitted;
  }

  /** The Realtime change numbered has been handed on: emitted as the latest rows, or dropped as unmoved. */
  handedOn(change: number): void {
    this.handed = Math.max(this.handed, change);
    for (const waiter of this.waiting) {
      if (waiter.emit === undefined && waiter.change <= this.handed) waiter.emit = this.emitted;
    }
    this.settle();
  }

  /** The caller is done with every emit up to the one numbered. */
  takenUpTo(emit: number): void {
    this.finished = Math.max(this.finished, emit);
    this.settle();
  }

  /** The last emit the caller was handed. */
  get deliveredSoFar(): number {
    return this.delivered;
  }

  /** The caller was handed the emits up to the one numbered. */
  deliver(emit: number): void {
    this.delivered = Math.max(this.delivered, emit);
  }

  /** Settles once the caller has finished with the rows of every Realtime change offered so far. */
  readonly shown: Effect.Effect<void> = Effect.callback<void>((resume) => {
    const waiter: { change: number; emit?: number; settle: () => void } = {
      change: this.changes,
      settle: () => resume(Effect.void),
    };
    if (waiter.change <= this.handed) waiter.emit = this.emitted;
    this.waiting.push(waiter);
    this.settle();
    return Effect.sync(() => {
      const at = this.waiting.indexOf(waiter);
      if (at >= 0) this.waiting.splice(at, 1);
    });
  });

  private settle(): void {
    for (const waiter of [...this.waiting]) {
      if (waiter.emit === undefined || waiter.emit > this.finished) continue;
      this.waiting.splice(this.waiting.indexOf(waiter), 1);
      waiter.settle();
    }
  }
}

/**
 * The ledgers of the reads followed within a stream `liveShown` marks, which
 * then says when the caller is done with their rows; none where no stream
 * is marked, and each read says it on its own next pull.
 */
const LiveShownAt = Context.Reference<{ readonly ledgers: Set<Shown> } | undefined>(
  "@luke/host/LiveShownAt",
  { defaultValue: () => undefined },
);

/**
 * Marks where a follow's rows are shown, for a follow that reshapes them
 * through a stage that pulls ahead on its own (`Stream.switchMap`), so a
 * write's wait settles only once what was made of its rows has been shown
 * here, rather than once the stage took them. Note that each pull here is
 * the caller done with the last element it was handed, and that element was
 * made of no rows past those delivered before it was handed.
 */
export function liveShown<A, E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> {
  return Stream.suspend(() => {
    const at = { ledgers: new Set<Shown>() };
    const madeOf = new Map<Shown, number>();
    return Stream.transformPull(Stream.provideService(stream, LiveShownAt, at), (pull) =>
      Effect.succeed(
        Effect.suspend(() => {
          for (const ledger of at.ledgers) ledger.takenUpTo(madeOf.get(ledger) ?? 0);
          return Effect.tap(pull, () =>
            Effect.sync(() => {
              for (const ledger of at.ledgers) madeOf.set(ledger, ledger.deliveredSoFar);
            }),
          );
        }),
      ),
    );
  });
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
  shown: Shown,
): Stream.Stream<
  { readonly change: number; readonly rows: Readonly<Record<Part, readonly unknown[]>> },
  LiveBroken
> {
  const parts = Object.keys(first.queries).filter((part): part is Part => part in first.queries);
  return Stream.callback<
    { readonly change: number; readonly rows: Readonly<Record<Part, readonly unknown[]>> },
    LiveBroken
  >((queue) =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => dependencies.openLive(first.url),
          catch: () => new LiveBroken({ reason: "Realtime's client did not load" }),
        }),
        (opened) => Effect.sync(() => opened.close()),
      );
      const rows = new Map<Part, readonly unknown[]>();
      /**
       * The read's wait for a write's transaction, handed out once every part
       * is live (its first result in) and taken back once they are let go.
       * Note that a write reaches only the parts whose rows it changes, so
       * the first part it reaches settles Realtime's wait; the wait then
       * holds until the caller has those rows (`Shown`), all within the
       * timeout.
       */
      let standing: ReadonlyArray<readonly [Part, LiveSubscription]> = [];
      let handed = false;
      const txWait: TxWait = (txid, timeout) =>
        Effect.tryPromise({
          try: () =>
            Promise.any(
              standing.map(([, subscription]) =>
                subscription.awaitTxId(txid, Duration.toMillis(timeout)),
              ),
            ),
          catch: () => new LiveBroken({ reason: "the write's transaction did not arrive" }),
        }).pipe(
          Effect.andThen(shown.shown),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(new LiveBroken({ reason: "the write's rows did not reach the caller" })),
          }),
        );
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
              Queue.offerUnsafe(queue, {
                change: shown.changed(),
                // SAFETY: `rows` holds every part once its size is the parts', and only parts.
                rows: whole as Readonly<Record<Part, readonly unknown[]>>,
              });
              if (handed) return;
              handed = true;
              dependencies.onTxWait?.(txWait);
            });
            return [part, subscription] as const;
          }),
        ),
        (subscribed) =>
          Effect.sync(() => {
            if (handed) dependencies.onTxWait?.(undefined);
            for (const [, subscription] of subscribed) subscription.unsubscribe();
          }),
      );
      standing = subscriptions;
      let expiresAt = earliestExpiry(first);
      const renewal = Effect.gen(function* () {
        const wait = expiresAt - Duration.toMillis(RENEW_EARLY) - dependencies.now();
        yield* Effect.sleep(Duration.millis(Math.max(0, wait)));
        let next = yield* dependencies.reseal();
        while ("failure" in next) {
          if (ended(next)) {
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

/**
 * Confirms a write once its transaction reaches the read that shows it, as
 * Neon's guide waits on `awaitTxId`: at once where the write changed no row
 * (no txid) or the read is not subscribed over Realtime (polled, or not yet
 * subscribed), since a poll shows the write on its next answer anyway. A
 * transaction that does not arrive within `TX_WAIT_TIMEOUT` is said in the
 * log and the write confirmed still, since it committed.
 */
export function confirmWrite(
  wait: TxWait | undefined,
  txid: string | undefined,
): Effect.Effect<void> {
  if (wait === undefined || txid === undefined) return Effect.void;
  return wait(txid, TX_WAIT_TIMEOUT).pipe(
    Effect.catch((why) =>
      Effect.logWarning(`live-follow: a write's transaction did not arrive (${why.reason})`),
    ),
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
  return Stream.unwrap(
    Effect.map(Effect.service(LiveShownAt), (at) => {
      const shown = new Shown();
      const followed = Stream.callback<
        { readonly emit: number; readonly rows: Readonly<Record<Part, readonly unknown[]>> },
        LiveBroken
      >((queue) =>
        Effect.gen(function* () {
          let last: string | undefined;
          const emit = (rows: Readonly<Record<Part, readonly unknown[]>>) => {
            const said = JSON.stringify(rows);
            if (said === last) return;
            last = said;
            Queue.offerUnsafe(queue, { emit: shown.emit(), rows });
          };
          const gone = () =>
            Queue.failCauseUnsafe(queue, Cause.fail(new LiveBroken({ reason: GONE })));

          /** Where the rows stood at the last poll, which the next is held past. */
          let seen: string | undefined;
          const pollOnce = Effect.gen(function* () {
            const read = yield* dependencies.poll(seen);
            if ("failure" in read) {
              if (ended(read)) {
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
                yield* Effect.logWarning(
                  `live-follow: Realtime failed (${why.reason}); polling`,
                ).pipe(Effect.annotateLogs(why.code === undefined ? {} : { code: why.code }));
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
          let sealed: SealedRead<Part> | { readonly failure: string; readonly gone?: boolean } =
            first;
          /**
           * One go at Realtime: followed until it breaks, polled from then on.
           * Answers whether to subscribe again later: not where the read is gone,
           * nor where the service answered it polled, Realtime being off.
           */
          const attempt = Effect.gen(function* () {
            if ("failure" in sealed) return ended(sealed) ? GONE : AGAIN;
            if (sealed.url === LIVE_POLL_URL) {
              const rows = rowsOf(parts, sealed);
              if (rows !== undefined) emit(rows);
              seen = liveDigestOf(sealed.queries) ?? seen;
              yield* startPolling(undefined);
              return STAY;
            }
            const broken = yield* Stream.runForEach(
              realtimeRows(dependencies, sealed, shown),
              ({ change, rows }) =>
                Effect.andThen(
                  stopPolling,
                  Effect.sync(() => {
                    emit(rows);
                    shown.handedOn(change);
                  }),
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
      // Note that the caller asks for rows again only once it is done with the last it was handed, which is what a write's wait holds for, unless a stream `liveShown` marks says it instead.
      at?.ledgers.add(shown);
      return Stream.transformPull(followed, (pull) =>
        Effect.succeed(
          Effect.suspend(() => {
            if (at === undefined) shown.takenUpTo(shown.deliveredSoFar);
            return pull.pipe(
              Effect.map((handed) => {
                for (const { emit } of handed) shown.deliver(emit);
                return Arr.map(handed, ({ rows }) => rows);
              }),
            );
          }),
        ),
      ).pipe(Stream.ensuring(Effect.sync(() => at?.ledgers.delete(shown))));
    }),
  );
}
