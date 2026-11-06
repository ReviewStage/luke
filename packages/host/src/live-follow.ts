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

export function waitOrRegained(duration: Duration.Input): Effect.Effect<void> {
  return Effect.asVoid(Effect.race(Effect.sleep(duration), Stream.runHead(serviceRegained)));
}

function untilRegained<Output, Input, Error, Env>(
  schedule: Schedule.Schedule<Output, Input, Error, Env>,
): Schedule.Schedule<Output, Input, Error, Env> {
  return schedule.pipe(
    Schedule.modifyDelay(({ duration }) => Effect.as(waitOrRegained(duration), Duration.zero)),
  );
}

const LIVE_POLL_FLOOR = Duration.millis(500);
const LIVE_POLL_WOKEN_FLOOR = Duration.millis(100);
const POLL_SPACING = Schedule.spaced(LIVE_POLL_FLOOR).pipe(
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(input === true ? LIVE_POLL_WOKEN_FLOOR : duration),
  ),
);
const POLL_BACKOFF = untilRegained(
  Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("5 seconds")]).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.map(Random.next, (drawn) => Duration.times(duration, drawn)),
    ),
  ),
);
function ended(failed: { readonly failure: string; readonly gone?: boolean }): boolean {
  return failed.gone === true || failed.failure === LIVE_SIGNED_OUT.failure;
}

export const LIVE_GONE = "the read is gone";
const GONE = LIVE_GONE;

export class LiveBroken extends Data.TaggedError("LiveBroken")<{
  readonly reason: string;
}> {}

export const TX_WAIT_TIMEOUT = Duration.seconds(10);

const SNAPSHOT_SPELLING = /^(\d+):(\d+):((?:\d+(?:,\d+)*)?)$/;
const TXID_SPELLING = /^\d+$/;

function shows(snapshot: string, txid: string): boolean {
  const spelled = SNAPSHOT_SPELLING.exec(snapshot);
  if (spelled === null || !TXID_SPELLING.test(txid)) return false;
  const [, xmin = "", xmax = "", running = ""] = spelled;
  const id = BigInt(txid);
  if (id < BigInt(xmin)) return true;
  if (id >= BigInt(xmax)) return false;
  return running === "" || !running.split(",").some((each) => BigInt(each) === id);
}

export type TxWait = (txid: string, timeout: Duration.Duration) => Effect.Effect<void, LiveBroken>;

export interface SyncStanding {
  readonly past: string | undefined;
  readonly next: string;
  readonly gone: readonly string[];
}

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

export function syncIdOf(standing: SyncStanding | undefined): bigint | undefined {
  return standing !== undefined && /^\d+$/.test(standing.next) ? BigInt(standing.next) : undefined;
}

export interface SealedRead<Part extends string> {
  readonly url: string;
  readonly queries: Readonly<Record<Part, SealedLiveQueryWire>>;
}

export interface LiveFollowDependencies<Part extends string> {
  readonly poll: (
    after: string | undefined,
    cursor?: string,
    sync?: string,
  ) => Effect.Effect<SealedRead<Part> | { readonly failure: string; readonly gone?: boolean }>;
  readonly onTxWait?: (wait: TxWait | undefined) => void;
  readonly behind?: () => void;
  readonly heldOn?: readonly Part[];
}

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

function txConfirmations() {
  const carried = new Map<string, number>();
  let snapshots: readonly string[] = [];
  const waiting = new Map<string, Set<Deferred.Deferred<void>>>();
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
    carry: (txids: readonly string[], now: number) => {
      forget(now);
      for (const txid of txids) {
        carried.delete(txid);
        carried.set(txid, now);
        settle(txid);
      }
    },
    see: (next: readonly string[]) => {
      snapshots = next;
      for (const txid of waiting.keys()) if (shown(txid)) settle(txid);
    },
  };
}

function txidsOf<Part extends string>(read: SealedRead<Part>): readonly string[] {
  return [
    ...new Set(
      Object.values<SealedLiveQueryWire>(read.queries).flatMap((query) => query.txids ?? []),
    ),
  ];
}

function snapshotsOf<Part extends string>(
  parts: readonly Part[],
  read: SealedRead<Part>,
): readonly string[] | undefined {
  const snapshots = parts.map((part) => read.queries[part].snapshot);
  return snapshots.every((snapshot) => snapshot !== undefined) ? snapshots : undefined;
}

function cursorOf<Part extends string>(read: SealedRead<Part>): string | undefined {
  return Object.values<SealedLiveQueryWire>(read.queries).find((query) => query.cursor)?.cursor
    ?.next;
}

function pastOf<Part extends string>(read: SealedRead<Part>): boolean {
  return Object.values<SealedLiveQueryWire>(read.queries).some(
    (query) => query.cursor?.past !== undefined,
  );
}

function rowsOf<Part extends string>(
  parts: readonly Part[],
  read: SealedRead<Part>,
): Readonly<Record<Part, readonly unknown[]>> | undefined {
  const rows = parts.map((part) => [part, read.queries[part].rows] as const);
  if (rows.some(([, carried]) => carried === undefined)) return undefined;
  return Object.fromEntries(rows) as Readonly<Record<Part, readonly unknown[]>>;
}

interface LiveAnswer<Part extends string> {
  readonly rows: Readonly<Record<Part, readonly unknown[]>>;
  readonly past: boolean;
}

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
      let seen = standing(first.queries);
      let cursor = cursorOf(first);
      let sync = syncStandingOf(first)?.next;
      let syncMovedAt = yield* Clock.currentTimeMillis;
      let failures = 0;
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
          last = undefined;
          seen = undefined;
          failures += 1;
          if (failures > 1) dependencies.behind?.();
          return yield* Effect.fail(read);
        }
        failures = 0;
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

export function liveRows<Part extends string>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
): Stream.Stream<Readonly<Record<Part, readonly unknown[]>>, LiveBroken> {
  return Stream.map(liveAnswers(dependencies, first), (answer) => answer.rows);
}

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

export function followTakingRows<Part extends string, Rows>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
  schema: Schema.Decoder<Rows>,
  take: (rows: Rows, standing?: SyncStanding) => Effect.Effect<void>,
): Effect.Effect<void, LiveBroken> {
  const decode = Schema.decodeUnknownOption(schema);
  const parts = Object.keys(first.queries).filter((part): part is Part => part in first.queries);
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

const SYNC_STALL = Duration.seconds(30);

export const FOLLOW_RESEAL = { FIRST: Duration.seconds(2), LONGEST: Duration.minutes(1) } as const;

export const FOLLOW_BACKOFF = untilRegained(
  Schedule.exponential(FOLLOW_RESEAL.FIRST).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.min(duration, FOLLOW_RESEAL.LONGEST)),
    ),
  ),
);

export const LIVE_RESTART = Duration.seconds(5);

export function restarting<E, R>(attempt: Effect.Effect<boolean, E, R>): Effect.Effect<void, E, R> {
  return Effect.asVoid(
    Effect.repeat(attempt, {
      schedule: untilRegained(Schedule.spaced(LIVE_RESTART)),
      while: (again) => again,
    }),
  );
}

export const LIVE_STATE = {
  WAITING: "waiting",
  STANDING: "standing",
  BROKEN: "broken",
  LIVE: "live",
  REFUSED: "refused",
} as const;
