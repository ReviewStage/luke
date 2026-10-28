import { LIVE_SIGNED_OUT, liveDigestOf, type SealedLiveQueryWire } from "@luke/features/live-wire";
import {
  Cause,
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Option,
  Queue,
  Random,
  Schedule,
  Schema,
  Stream,
} from "effect";

/**
 * live-follow.ts -- a read the host follows over the service's held poll: the first answer's rows, then a poll past where they stood, held by the service until they move.
 *
 * Each read is one or more parts, each answered with its rows inline at the
 * poll address (`LIVE_POLL_URL`) and a digest of where they stand. The rows
 * of every part are handed on whole, undecoded, for the caller to decode at
 * this boundary, and again each time any part moves. A poll names where the
 * rows last stood (`liveDigestOf`), the service holds it until they move or
 * a while passes, and it is asked again once the floor passes, a failed one
 * after a wait drawn at random up to a second and then up to five, the
 * caller told it may be behind meanwhile.
 *
 * A held poll Luke Sync woke answers with the txids of the writes that woke
 * it. From the first such answer on, the read hands the caller a wait for a
 * write's transaction (`onTxWait`), which a writer confirms its write on
 * (`confirmWrite`), and it asks again after the service's coalesce window
 * rather than the floor, since a write that lands meanwhile is answered at
 * once.
 */

/** The least time between two polls, so a service answering at once is not asked in a hot loop; each poll is otherwise held by the service until the rows move. */
const LIVE_POLL_FLOOR = Duration.millis(500);
/** The least time after an answer a write woke before the next poll: the 100 ms the service gathers a burst of writes into one answer for. */
const LIVE_POLL_WOKEN_FLOOR = Duration.millis(100);
/** The wait before each poll after the first, by whether the answer before it was one a write woke. */
const POLL_SPACING = Schedule.spaced(LIVE_POLL_FLOOR).pipe(
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(input === true ? LIVE_POLL_WOKEN_FLOOR : duration),
  ),
);
/**
 * How a poll that failed is asked again: after a wait drawn at random up to
 * a second, then up to two, four, and five, so the windows a deploy or an
 * outage failed together do not all ask again in step. This is the full
 * jitter of Electric's client
 * (https://github.com/electric-sql/electric/blob/3f9809fb0bd894cb74470d434749673492ad7acf/packages/typescript-client/src/fetch.ts).
 * Note that it is not `Schedule.jittered`, which keeps each wait within a
 * fifth of its bound, too close to spread windows that failed together.
 */
const POLL_BACKOFF = Schedule.min([
  Schedule.exponential("1 second"),
  Schedule.spaced("5 seconds"),
]).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.map(Random.next, (drawn) => Duration.times(duration, drawn)),
  ),
);
/**
 * Whether a failed poll ends the read for good: it names nothing the account
 * reaches any more, or the service refused the session as signed out, which
 * is never asked again.
 */
function ended(failed: { readonly failure: string; readonly gone?: boolean }): boolean {
  return failed.gone === true || failed.failure === LIVE_SIGNED_OUT.failure;
}

/** Why a read stopped for good: it names nothing the account reaches any more, or its session signed out. */
export const LIVE_GONE = "the read is gone";
const GONE = LIVE_GONE;

/** A follow that stopped for good: the read is gone, or a row did not decode. */
export class LiveBroken extends Data.TaggedError("LiveBroken")<{
  readonly reason: string;
}> {}

/** How long a write waits for its transaction to reach the read that shows it, so a write is never held unbounded, and how long an answer's txids are kept for a write whose own answer lands after it. */
const TX_WAIT_TIMEOUT = Duration.seconds(10);

/**
 * A wait for a write's transaction to arrive on a followed read: it settles
 * once an answer carrying it has been handed on, and fails once the timeout
 * passes.
 */
export type TxWait = (txid: string, timeout: Duration.Duration) => Effect.Effect<void, LiveBroken>;

/** A read answered for following: the address it was answered at, and each part's answer. */
export interface SealedRead<Part extends string> {
  readonly url: string;
  readonly queries: Readonly<Record<Part, SealedLiveQueryWire>>;
}

export interface LiveFollowDependencies<Part extends string> {
  /**
   * The read with each part's rows inline (`LIVE_POLL_URL`), held by the
   * service until the rows move past `after` (`liveDigestOf`); a failure
   * where the service answered none, asked again a second later, or `gone`
   * where the read names nothing the account reaches any more, which stops
   * the follow.
   */
  readonly poll: (
    after: string | undefined,
  ) => Effect.Effect<SealedRead<Part> | { readonly failure: string; readonly gone?: boolean }>;
  /**
   * Hears the read's wait for a write's transaction once an answer carried
   * txids, which only one Luke Sync woke does, and none once it is let go.
   * A read no answer of which carried any hands none.
   */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
  /**
   * Hears that the rows last handed on may be behind: a poll failed and is
   * asked again. The next rows a poll answers are handed on even where they
   * did not move, so the caller hears that it caught up.
   */
  readonly behind?: () => void;
}

/**
 * Confirms a write once its transaction reaches the read that shows it: at
 * once where the write changed no row (no txid) or no wait is handed, as for
 * a read Luke Sync does not wake, since a poll shows the write on its next
 * answer anyway. A transaction that does not arrive within `TX_WAIT_TIMEOUT`
 * is said in the log and the write confirmed still, since it committed.
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

/**
 * A followed read's confirmations: the txids its answers carried, each kept
 * `TX_WAIT_TIMEOUT` from when its answer was handed on, and the writes
 * waiting for one not carried yet. A wait settles on the first answer
 * carrying its txid, or at once where one already did within that time,
 * since the follow's answer often lands before the write's own.
 */
function txConfirmations() {
  /** Each txid carried, by when its answer was handed on, oldest first. */
  const carried = new Map<string, number>();
  const waiting = new Map<string, Set<Deferred.Deferred<void>>>();
  const forget = (now: number) => {
    for (const [txid, at] of carried) {
      if (now - at < Duration.toMillis(TX_WAIT_TIMEOUT)) return;
      carried.delete(txid);
    }
  };
  const wait: TxWait = (txid, timeout) =>
    Effect.gen(function* () {
      forget(yield* Clock.currentTimeMillis);
      if (carried.has(txid)) return;
      const arrived = Deferred.makeUnsafe<void>();
      const ofTxid = waiting.get(txid) ?? new Set();
      waiting.set(txid, ofTxid.add(arrived));
      yield* Deferred.await(arrived).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.fail(new LiveBroken({ reason: "the write's transaction did not arrive" })),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            ofTxid.delete(arrived);
            if (ofTxid.size === 0 && waiting.get(txid) === ofTxid) waiting.delete(txid);
          }),
        ),
      );
    });
  return {
    wait,
    /** An answer carrying the txids was handed on: every wait on one of them settles. */
    carry: (txids: readonly string[], now: number) => {
      forget(now);
      for (const txid of txids) {
        // Note that a txid carried again is moved to the end, so the map stays oldest first.
        carried.delete(txid);
        carried.set(txid, now);
        for (const arrived of waiting.get(txid) ?? []) Deferred.doneUnsafe(arrived, Effect.void);
      }
    },
  };
}

/** The txids an answer carries, each once: every part it answers carries them. */
function txidsOf<Part extends string>(read: SealedRead<Part>): readonly string[] {
  return [
    ...new Set(
      Object.values<SealedLiveQueryWire>(read.queries).flatMap((query) => query.txids ?? []),
    ),
  ];
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
 * long as the caller reads: the first answer's, then each poll's that moved
 * (see the module's note). A write's wait settles once the rows of the
 * answer carrying its txid are handed on. It fails only where the read is
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
      const confirmations = txConfirmations();
      let handed = false;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (handed) dependencies.onTxWait?.(undefined);
        }),
      );
      /** Hands the answer's rows on, then its txids, answering whether a write woke it. */
      const answered = (read: SealedRead<Part>) =>
        Effect.gen(function* () {
          const rows = rowsOf(parts, read);
          if (rows !== undefined) emit(rows);
          const txids = txidsOf(read);
          if (txids.length === 0) return false;
          confirmations.carry(txids, yield* Clock.currentTimeMillis);
          if (!handed) {
            handed = true;
            dependencies.onTxWait?.(confirmations.wait);
          }
          return true;
        });
      /** Where the rows stood at the last answer, which the next poll is held past. */
      let seen = liveDigestOf(first.queries);
      yield* answered(first);
      const pollOnce = Effect.gen(function* () {
        const read = yield* dependencies.poll(seen);
        if ("failure" in read) {
          if (ended(read)) {
            Queue.failCauseUnsafe(queue, Cause.fail(new LiveBroken({ reason: GONE })));
            return yield* Effect.never;
          }
          // Note that the next poll asks for the rows whole, past no digest, and hands them on moved or not, since the caller was told they may be behind.
          last = undefined;
          seen = undefined;
          dependencies.behind?.();
          return yield* Effect.fail(read);
        }
        seen = liveDigestOf(read.queries) ?? seen;
        return yield* answered(read);
      });
      yield* Effect.forkScoped(
        pollOnce.pipe(Effect.retry(POLL_BACKOFF), Effect.repeat(POLL_SPACING)),
      );
    }),
  );
}

/**
 * Every part's rows as `liveRows` delivers them, each decoded under
 * `schema` at this boundary. It fails where the read is gone or a delivery
 * does not decode, which the caller answers by sealing it again.
 */
export function decodedLiveRows<Part extends string, Rows>(
  dependencies: Omit<LiveFollowDependencies<Part>, "onTxWait"> & {
    readonly onTxWait?: LiveFollowDependencies<Part>["onTxWait"] | undefined;
  },
  first: SealedRead<Part>,
  schema: Schema.Decoder<Rows>,
): Stream.Stream<Rows, LiveBroken> {
  const decode = Schema.decodeUnknownOption(schema);
  const { onTxWait, ...rest } = dependencies;
  return liveRows({ ...rest, ...(onTxWait === undefined ? undefined : { onTxWait }) }, first).pipe(
    Stream.mapEffect((read) =>
      Option.match(decode(read), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: Effect.succeed,
      }),
    ),
  );
}

/** How long a follow that stopped, or whose read the service did not answer, waits before it is read again. */
export const LIVE_RESTART = Duration.seconds(5);

/**
 * `attempt` run until it answers that the follow ended, each run that
 * answers it goes on followed by the next `LIVE_RESTART` later. Note that a
 * run that ends the follow is followed by no wait, since `while` ends the
 * repeat before the schedule sleeps.
 */
export function restarting<E, R>(attempt: Effect.Effect<boolean, E, R>): Effect.Effect<void, E, R> {
  return Effect.asVoid(
    Effect.repeat(attempt, { schedule: Schedule.spaced(LIVE_RESTART), while: (again) => again }),
  );
}

/** Where a follow held in a map stands: its entry live or refused, and its state waiting, standing, or broken. */
export const LIVE_STATE = {
  WAITING: "waiting",
  STANDING: "standing",
  BROKEN: "broken",
  LIVE: "live",
  REFUSED: "refused",
} as const;
