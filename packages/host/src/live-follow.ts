import { LIVE_SIGNED_OUT, liveDigestOf, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Cause, Data, Duration, Effect, Option, Queue, Schedule, Schema, Stream } from "effect";

/**
 * live-follow.ts -- a read the host follows over the service's held poll: the first answer's rows, then a poll past where they stood, held by the service until they move.
 *
 * Each read is one or more parts, each answered with its rows inline at the
 * poll address (`LIVE_POLL_URL`) and a digest of where they stand. The rows
 * of every part are handed on whole, undecoded, for the caller to decode at
 * this boundary, and again each time any part moves. A poll names where the
 * rows last stood (`liveDigestOf`), the service holds it until they move or
 * a while passes, and it is asked again once the floor passes, a failed one
 * a second later and then up to five, the caller told it may be behind
 * meanwhile.
 */

/** The least time between two polls, so a service answering at once is not asked in a hot loop; each poll is otherwise held by the service until the rows move. */
const LIVE_POLL_FLOOR = Duration.millis(500);
/** How a poll that failed is asked again: a second later, then longer, up to five seconds. */
const POLL_BACKOFF = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("5 seconds")]);
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

/** How long a write waits for its transaction to reach the read that shows it, so a write is never held unbounded. */
const TX_WAIT_TIMEOUT = Duration.seconds(10);

/**
 * A wait for a write's transaction to arrive on a followed read: it settles
 * once the read has it, and fails once the timeout passes.
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
   * Hears the read's wait for a write's transaction, and none once it is let
   * go. A polled read has no transaction to wait on, so none is handed.
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
 * a polled read, since a poll shows the write on its next answer anyway. A
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
 * long as the caller reads: the first answer's, then each poll's that moved
 * (see the module's note). It fails only where the read is gone.
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
      /** Where the rows stood at the last answer, which the next poll is held past. */
      let seen = liveDigestOf(first.queries);
      const firstRows = rowsOf(parts, first);
      if (firstRows !== undefined) emit(firstRows);
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
        const rows = rowsOf(parts, read);
        if (rows !== undefined) emit(rows);
      });
      yield* Effect.forkScoped(
        pollOnce.pipe(Effect.retry(POLL_BACKOFF), Effect.repeat(Schedule.spaced(LIVE_POLL_FLOOR))),
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
