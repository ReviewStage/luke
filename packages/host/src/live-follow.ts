import { ServiceReach } from "@repo/features";
import {
  LIVE_SIGNED_OUT,
  liveDigestOf,
  liveDigestOn,
  type SealedLiveQueryWire,
} from "@repo/features/live-wire";
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
  SubscriptionRef,
} from "effect";

/**
 * live-follow.ts -- a read the host follows over the service's held poll: the first answer's rows, then a poll past where they stood, held by the service until they move.
 *
 * Each read is one or more parts, each answered with its rows inline at the
 * poll address (`LIVE_POLL_URL`) and a digest of where they stand. The rows
 * of every part are handed on whole, undecoded, for the caller to decode at
 * this boundary, and again each time any part moves. A poll names where the
 * rows last stood (`liveDigestOf`), the service holds it until they move or
 * a while passes, or, for a read held on some of its parts alone
 * (`heldOn`), until those move (`liveDigestOn`), and it is asked again once
 * the floor passes, a failed one
 * after a wait drawn at random up to a second and then up to five, the
 * caller told it may be behind meanwhile.
 *
 * Each part of an answer carries the snapshot it was read at, and a held
 * poll Sync woke carries the txids of the writes that woke it too. From the
 * first answer carrying either on, the read hands the caller a wait for a
 * write's transaction (`onTxWait`), which a writer confirms its write on
 * (`confirmWrite`) once an answer every part of which was read at a
 * snapshot that shows it, or one carrying its txid, is handed on, whatever
 * woke the poll. After an answer carrying txids it asks again after the
 * service's coalesce window rather than the floor, since a write that
 * lands meanwhile is answered at once.
 *
 * A read whose parts the caller follows by cursor (the transcript's newest
 * messages) is answered those parts only past the cursor it was last
 * answered (`LIVE_POLL.CURSOR`), which each poll sends back, and the caller
 * joins such an answer onto the rows it holds (`decodedLiveRows`'s
 * `joined`); one past no cursor of the reader's, as after a rewind, is
 * whole, and taken in their place.
 *
 * A read followed by sync id (`LIVE_POLL.SYNC`), as the account's inbox
 * items are, is asked past the id its last answer named, and answered only
 * what moved since, with the ids of rows that stand no longer for the
 * reader, or whole where it is too far behind (`SyncStanding`); an id that
 * stalls is answered around (`SYNC_STALL`).
 */

/**
 * Each time the service answers again after a call it left unanswered, as
 * the host's reach says (`ServiceReach`), heard from the moment the stream
 * runs; never where the host keeps no reach. Note that the reach the stream
 * starts at is left out, so a reach that stands answering wakes nothing.
 */
const serviceRegained: Stream.Stream<boolean> = Stream.unwrap(
  Effect.map(
    Effect.serviceOption(ServiceReach),
    Option.match({
      onNone: () => Stream.never,
      onSome: (reach) =>
        SubscriptionRef.changes(reach).pipe(
          Stream.map((state) => state.reachable),
          Stream.changes,
          Stream.drop(1),
          Stream.filter((reachable) => reachable),
        ),
    }),
  ),
);

/** Whether the service answered the last word the host had of it (`ServiceReach`); answering where the host keeps no reach. */
export const serviceAnswers: Effect.Effect<boolean> = Effect.flatMap(
  Effect.serviceOption(ServiceReach),
  Option.match({
    onNone: () => Effect.succeed(true),
    onSome: (reach) => Effect.map(SubscriptionRef.get(reach), (state) => state.reachable),
  }),
);

/**
 * `duration` waited out, or less where the service answers again first
 * (`serviceRegained`), so a read waiting to ask again after a failure asks
 * the moment the connection is back rather than at the end of its wait.
 */
export function waitOrRegained(duration: Duration.Input): Effect.Effect<void> {
  return Effect.asVoid(Effect.race(Effect.sleep(duration), Stream.runHead(serviceRegained)));
}

/** `schedule` with each of its waits ended early where the service answers again (`waitOrRegained`). */
function untilRegained<Output, Input, Error, Env>(
  schedule: Schedule.Schedule<Output, Input, Error, Env>,
): Schedule.Schedule<Output, Input, Error, Env> {
  // Note that the wait is made here and the schedule then waits no longer, since a schedule's own sleep hears nothing.
  return schedule.pipe(
    Schedule.modifyDelay(({ duration }) => Effect.as(waitOrRegained(duration), Duration.zero)),
  );
}

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
 * fifth of its bound, too close to spread windows that failed together. A
 * wait ends at once where the service answers again (`untilRegained`).
 */
const POLL_BACKOFF = untilRegained(
  Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("5 seconds")]).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.map(Random.next, (drawn) => Duration.times(duration, drawn)),
    ),
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
export const TX_WAIT_TIMEOUT = Duration.seconds(10);

/** A snapshot as Postgres spells one (`pg_current_snapshot()::text`): `xmin:xmax:xip,…`, the transactions it lists as running, if any, joined by commas. */
const SNAPSHOT_SPELLING = /^(\d+):(\d+):((?:\d+(?:,\d+)*)?)$/;
/** A transaction id as a writer answers one (`pg_current_xact_id()::text`). */
const TXID_SPELLING = /^\d+$/;

/**
 * Whether the transaction `txid` is visible in `snapshot`, as
 * `pg_visible_in_snapshot` reads it: it ended before every transaction the
 * snapshot saw running (below `xmin`), or below the snapshot's horizon
 * (`xmax`) and is not among those it lists as running. A writer hands a
 * transaction that committed, so one that ended is one that committed. Note
 * that the ids are compared as `BigInt`, since both are 64-bit, and that a
 * snapshot or txid that does not read as one shows nothing, so the write
 * waits on its txid instead.
 */
function shows(snapshot: string, txid: string): boolean {
  const spelled = SNAPSHOT_SPELLING.exec(snapshot);
  if (spelled === null || !TXID_SPELLING.test(txid)) return false;
  const [, xmin = "", xmax = "", running = ""] = spelled;
  const id = BigInt(txid);
  if (id < BigInt(xmin)) return true;
  if (id >= BigInt(xmax)) return false;
  return running === "" || !running.split(",").some((each) => BigInt(each) === id);
}

/**
 * A wait for a write's transaction to arrive on a followed read: it settles
 * once an answer carrying it, or read at snapshots that all show it, has
 * been handed on, and fails once the timeout passes.
 */
export type TxWait = (txid: string, timeout: Duration.Duration) => Effect.Effect<void, LiveBroken>;

/**
 * Where an answer of a read followed by sync id stands: the id its rows
 * were read past, none where they are whole; the id to read past next; and
 * the ids of the rows that stand no longer for the reader, every part's.
 */
export interface SyncStanding {
  readonly past: string | undefined;
  readonly next: string;
  readonly gone: readonly string[];
}

/** Where an answer stands by sync id; none for an answer of a read not followed by one, or asked whole without one. */
export function syncStandingOf<Part extends string>(
  read: SealedRead<Part>,
): SyncStanding | undefined {
  const parts = Object.values<SealedLiveQueryWire>(read.queries);
  const answered = parts.find((query) => query.sync !== undefined)?.sync;
  if (answered === undefined) return undefined;
  return {
    past: answered.past,
    next: answered.next,
    gone: [...new Set(parts.flatMap((query) => query.gone ?? []))],
  };
}

/** The sync id an answer was read at, as the host compares one, from the decimal it spells; none where it spells none. */
export function syncIdOf(standing: SyncStanding | undefined): bigint | undefined {
  return standing !== undefined && /^\d+$/.test(standing.next) ? BigInt(standing.next) : undefined;
}

/** A read answered for following: the address it was answered at, and each part's answer. */
export interface SealedRead<Part extends string> {
  readonly url: string;
  readonly queries: Readonly<Record<Part, SealedLiveQueryWire>>;
}

export interface LiveFollowDependencies<Part extends string> {
  /**
   * The read with each part's rows inline (`LIVE_POLL_URL`), held by the
   * service until the rows move past `after` (`liveDigestOf`), its cursor
   * parts past `cursor`, the one its last answer named, where it has any,
   * and, for a read followed by sync id, past `sync`, the id its last answer
   * named, or whole where none is given, as after a stall; a failure where
   * the service answered none, asked again a second later, or `gone` where
   * the read names nothing the account reaches any more, which stops the
   * follow.
   */
  readonly poll: (
    after: string | undefined,
    cursor?: string,
    sync?: string,
  ) => Effect.Effect<SealedRead<Part> | { readonly failure: string; readonly gone?: boolean }>;
  /**
   * Hears the read's wait for a write's transaction once an answer carried
   * a snapshot on every part, or the txids only an answer Sync woke
   * carries, and none once it is let go. A read no answer of which carried
   * either, as one of a service before snapshots may be, hands none.
   */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
  /**
   * Hears that the rows last handed on may be behind: a poll failed and is
   * asked again. The next rows a poll answers are handed on even where they
   * did not move, so the caller hears that it caught up.
   */
  readonly behind?: () => void;
  /**
   * The parts the service holds a poll on alone, whose digest alone is sent
   * as `after` (`liveDigestOn`); every part where none are named. A read
   * held on some parts answers the others only past the reader's own query,
   * so their digest would move with every answer and never be held.
   */
  readonly heldOn?: readonly Part[];
}

/**
 * Confirms a write once its transaction reaches the read that shows it: at
 * once where the write changed no row (no txid) or no wait is handed, as
 * before the read's first answer, or for one of a service before snapshots
 * that Sync does not wake, since a poll shows the write on its next answer
 * anyway. A transaction that does not arrive within `TX_WAIT_TIMEOUT`
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
 * `TX_WAIT_TIMEOUT` from when its answer was handed on, the snapshots the
 * last answer that carried one on every part was read at, and the writes
 * waiting for one not shown yet. A wait settles on the first answer
 * carrying its txid, or every part of which shows it, or at once where one
 * already did, since the follow's answer often lands before the write's
 * own. Note that only the last answer's snapshots are kept, because each
 * answer of a read is read after the one before, so it shows at least as
 * much.
 */
function txConfirmations() {
  /** Each txid carried, by when its answer was handed on, oldest first. */
  const carried = new Map<string, number>();
  /** The snapshot each part of the last answer was read at; none before an answer carried one on every part. */
  let snapshots: readonly string[] = [];
  const waiting = new Map<string, Set<Deferred.Deferred<void>>>();
  /** Whether every part of the last answer read at snapshots shows the transaction. */
  const shown = (txid: string) =>
    snapshots.length > 0 && snapshots.every((snapshot) => shows(snapshot, txid));
  const settle = (txid: string) => {
    for (const arrived of waiting.get(txid) ?? []) Deferred.doneUnsafe(arrived, Effect.void);
  };
  const forget = (now: number) => {
    for (const [txid, at] of carried) {
      if (now - at < Duration.toMillis(TX_WAIT_TIMEOUT)) return;
      carried.delete(txid);
    }
  };
  const wait: TxWait = (txid, timeout) =>
    Effect.gen(function* () {
      forget(yield* Clock.currentTimeMillis);
      if (carried.has(txid) || shown(txid)) return;
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
        settle(txid);
      }
    },
    /** An answer every part of which carried the snapshot it was read at was handed on: every wait on a transaction they all show settles. */
    see: (next: readonly string[]) => {
      snapshots = next;
      for (const txid of waiting.keys()) if (shown(txid)) settle(txid);
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

/** The snapshot each part of an answer was read at; none where a part carries none, as from a service before snapshots. */
function snapshotsOf<Part extends string>(
  parts: readonly Part[],
  read: SealedRead<Part>,
): readonly string[] | undefined {
  const snapshots = parts.map((part) => read.queries[part].snapshot);
  return snapshots.every((snapshot) => snapshot !== undefined) ? snapshots : undefined;
}

/** The cursor an answer's cursor parts name to read past next; none for a read with no cursor parts. */
function cursorOf<Part extends string>(read: SealedRead<Part>): string | undefined {
  return Object.values<SealedLiveQueryWire>(read.queries).find((query) => query.cursor)?.cursor
    ?.next;
}

/** Whether an answer's cursor parts are only what moved past the reader's cursor, rather than whole. */
function pastOf<Part extends string>(read: SealedRead<Part>): boolean {
  return Object.values<SealedLiveQueryWire>(read.queries).some(
    (query) => query.cursor?.past !== undefined,
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

/** An answer's rows, undecoded, and whether its cursor parts are only what moved past the reader's cursor, for the caller to join onto the rows it holds. */
interface LiveAnswer<Part extends string> {
  readonly rows: Readonly<Record<Part, readonly unknown[]>>;
  readonly past: boolean;
}

/**
 * Every answer's rows, undecoded, each time they change, for as long as the
 * caller reads: the first answer's, then each poll's that moved (see the
 * module's note). A write's wait settles once the rows of the answer
 * carrying its txid, or read at snapshots that all show it, are handed on.
 * It fails only where the read is gone.
 */
function liveAnswers<Part extends string>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
): Stream.Stream<LiveAnswer<Part>, LiveBroken> {
  const parts = Object.keys(first.queries).filter((part): part is Part => part in first.queries);
  return Stream.callback<LiveAnswer<Part>, LiveBroken>((queue) =>
    Effect.gen(function* () {
      let last: string | undefined;
      const emit = (answer: LiveAnswer<Part>) => {
        const said = JSON.stringify(answer);
        if (said === last) return;
        last = said;
        Queue.offerUnsafe(queue, answer);
      };
      const confirmations = txConfirmations();
      let handed = false;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (handed) dependencies.onTxWait?.(undefined);
        }),
      );
      /** Hands the answer's rows on, then its snapshots and its txids, answering whether a write woke it. */
      const answered = (read: SealedRead<Part>) =>
        Effect.gen(function* () {
          const rows = rowsOf(parts, read);
          if (rows !== undefined) emit({ rows, past: pastOf(read) });
          const snapshots = snapshotsOf(parts, read);
          if (snapshots !== undefined) confirmations.see(snapshots);
          const txids = txidsOf(read);
          if (txids.length > 0) confirmations.carry(txids, yield* Clock.currentTimeMillis);
          if (!handed && (snapshots !== undefined || txids.length > 0)) {
            handed = true;
            dependencies.onTxWait?.(confirmations.wait);
          }
          return txids.length > 0;
        });
      const standing = (queries: SealedRead<Part>["queries"]) =>
        dependencies.heldOn === undefined
          ? liveDigestOf(queries)
          : liveDigestOn(queries, dependencies.heldOn);
      /** Where the rows stood at the last answer, which the next poll is held past. */
      let seen = standing(first.queries);
      /** The cursor the last answer named, past which the next poll reads the cursor parts; kept through a failed poll, since the rows held stand at it still. */
      let cursor = cursorOf(first);
      /** The sync id the last answer named, past which the next poll reads; kept through a failed poll, and a whole answer that names none. */
      let sync = syncStandingOf(first)?.next;
      /** When the sync id last moved, or a stall was last asked around, by the host's clock. */
      let syncMovedAt = yield* Clock.currentTimeMillis;
      yield* answered(first);
      const pollOnce = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const stalled = sync !== undefined && now - syncMovedAt > Duration.toMillis(SYNC_STALL);
        if (stalled) syncMovedAt = now;
        const read = yield* dependencies.poll(seen, cursor, stalled ? undefined : sync);
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
        seen = standing(read.queries) ?? seen;
        cursor = cursorOf(read) ?? cursor;
        const next = syncStandingOf(read)?.next;
        if (next !== undefined && next !== sync) {
          sync = next;
          syncMovedAt = yield* Clock.currentTimeMillis;
        }
        return yield* answered(read);
      });
      yield* Effect.forkScoped(
        pollOnce.pipe(Effect.retry(POLL_BACKOFF), Effect.repeat(POLL_SPACING)),
      );
    }),
  );
}

/**
 * Every part's rows, whole and undecoded, each time they change, for as
 * long as the caller reads (`liveAnswers`), for a read with no cursor parts.
 */
export function liveRows<Part extends string>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
): Stream.Stream<Readonly<Record<Part, readonly unknown[]>>, LiveBroken> {
  return Stream.map(liveAnswers(dependencies, first), (answer) => answer.rows);
}

/**
 * Every part's rows as `liveAnswers` delivers them, each decoded under
 * `schema` at this boundary, and an answer whose cursor parts are only what
 * moved past the cursor joined onto the rows last handed on (`joined`),
 * which a read the caller follows by cursor names. It fails where the read
 * is gone or a delivery does not decode, which the caller answers by
 * sealing it again.
 */
export function decodedLiveRows<Part extends string, Rows>(
  dependencies: Omit<LiveFollowDependencies<Part>, "onTxWait"> & {
    readonly onTxWait?: LiveFollowDependencies<Part>["onTxWait"] | undefined;
  },
  first: SealedRead<Part>,
  schema: Schema.Decoder<Rows>,
  joined?: (held: Rows, past: Rows) => Rows,
): Stream.Stream<Rows, LiveBroken> {
  const decode = Schema.decodeUnknownOption(schema);
  const { onTxWait, ...rest } = dependencies;
  return liveAnswers(
    { ...rest, ...(onTxWait === undefined ? undefined : { onTxWait }) },
    first,
  ).pipe(
    Stream.mapEffect((answer) =>
      Option.match(decode(answer.rows), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: (rows) => Effect.succeed({ rows, past: answer.past }),
      }),
    ),
    Stream.mapAccum(
      (): Rows | undefined => undefined,
      (held, answer) => {
        const rows =
          held !== undefined && answer.past && joined !== undefined
            ? joined(held, answer.rows)
            : answer.rows;
        return [rows, [rows]] as const;
      },
    ),
  );
}

/**
 * A read followed until it is gone, each answer's rows, every part's,
 * decoded under `schema` and handed to `take` the moment its poll answers,
 * with where it stands by sync id for a read followed by one, before the
 * follow carries the answer's snapshots and txids on to a write waiting for
 * them. So a write confirmed on the read finds its rows already
 * taken, where a reader of `decodedLiveRows` may not have taken them yet. An
 * answer carrying no rows inline hands none; one whose rows do not decode
 * is a failed poll, asked again, and a first one fails the follow, which
 * the caller seals again.
 */
export function followTakingRows<Part extends string, Rows>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
  schema: Schema.Decoder<Rows>,
  take: (rows: Rows, standing?: SyncStanding) => Effect.Effect<void>,
): Effect.Effect<void, LiveBroken> {
  const decode = Schema.decodeUnknownOption(schema);
  const parts = Object.keys(first.queries).filter((part): part is Part => part in first.queries);
  /** Takes the answer's rows where it carries them, answering whether they decoded. */
  const taken = (read: SealedRead<Part>) => {
    const carried = rowsOf(parts, read);
    if (carried === undefined) return Effect.succeed(true);
    return Option.match(decode(carried), {
      onNone: () => Effect.succeed(false),
      onSome: (rows) => Effect.as(take(rows, syncStandingOf(read)), true),
    });
  };
  return Effect.gen(function* () {
    if (!(yield* taken(first))) return yield* new LiveBroken({ reason: "a row did not decode" });
    const poll: LiveFollowDependencies<Part>["poll"] = (after, cursor, sync) =>
      Effect.flatMap(dependencies.poll(after, cursor, sync), (read) =>
        "failure" in read
          ? Effect.succeed(read)
          : Effect.map(taken(read), (decoded) =>
              decoded ? read : { failure: "a row did not decode" },
            ),
      );
    yield* Stream.runDrain(liveRows({ ...dependencies, poll }, first));
  });
}

/**
 * How long a sync id may stand still before the next poll asks whole,
 * without it, once, and again each time as long passes still. Note that a
 * sync id is the cluster's settled id, which moves whenever any transaction
 * anywhere ends, and the devices' beats alone end one every 15 s, so an id
 * that stood still past a 25 s hold is a long transaction holding every
 * delta back, as a migration during a deploy does, or a database nothing
 * writes to, where a whole answer each 30 s costs nothing. The host cannot
 * see the wakes behind a stalled id, since a delta held over one answers
 * empty and carries no txids.
 */
const SYNC_STALL = Duration.seconds(30);

/**
 * How long a live follow waits before sealing again after a seal the
 * service did not answer, or a follow that stopped: the first wait, doubling
 * on each that fails again, up to the longest, and ended at once where the
 * service answers again (`untilRegained`).
 */
export const FOLLOW_RESEAL = { FIRST: Duration.seconds(2), LONGEST: Duration.minutes(1) } as const;

export const FOLLOW_BACKOFF = untilRegained(
  Schedule.exponential(FOLLOW_RESEAL.FIRST).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.min(duration, FOLLOW_RESEAL.LONGEST)),
    ),
  ),
);

/** How long a follow that stopped, or whose read the service did not answer, waits before it is read again. */
export const LIVE_RESTART = Duration.seconds(5);

/**
 * `attempt` run until it answers that the follow ended, each run that
 * answers it goes on followed by the next `LIVE_RESTART` later, or as soon
 * as the service answers again (`untilRegained`). Note that a
 * run that ends the follow is followed by no wait, since `while` ends the
 * repeat before the schedule sleeps.
 */
export function restarting<E, R>(attempt: Effect.Effect<boolean, E, R>): Effect.Effect<void, E, R> {
  return Effect.asVoid(
    Effect.repeat(attempt, {
      schedule: untilRegained(Schedule.spaced(LIVE_RESTART)),
      while: (again) => again,
    }),
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
