import type { LiveRead } from "@repo/features/live-wire";
import {
  type EntityKind,
  type EntityPool,
  type FieldChange,
  type ROW_GONE,
  type RowCollection,
  rowOf,
  syncedCollection,
} from "@repo/sync";
import type { WithoutVirtualProps } from "@tanstack/db";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Equal,
  FiberMap,
  MutableHashMap,
  Option,
  Queue,
  type Scope,
  Stream,
} from "effect";
import {
  type AppHostRead,
  type AppHostReads,
  type AppState,
  type HOST_READ_SLICE,
  type HostReadKeyPath,
  type HostReadSlice,
  type KEYS_ON,
  UNREAD,
} from "./app-state.js";
import { TX_WAIT_TIMEOUT } from "./live-follow.js";

export function rowsOf<Row extends object>(collection: {
  readonly toArray: readonly Row[];
}): WithoutVirtualProps<Row>[] {
  return collection.toArray.map((stored) => rowOf<WithoutVirtualProps<Row>>(stored));
}

export function rowAt<Row extends object, Key extends string>(
  collection: RowCollection<Row, Key>,
  key: Key,
): WithoutVirtualProps<Row> | undefined {
  const stored = collection.get(key);
  return stored === undefined ? undefined : rowOf<WithoutVirtualProps<Row>>(stored);
}

export function drawnAtEdges(
  draw: (at: number) => number | undefined,
): Effect.Effect<Effect.Effect<void>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const edges = yield* Queue.sliding<number | undefined>(1);
    const drawn = Effect.flatMap(Clock.currentTimeMillis, (at) =>
      Effect.asVoid(Queue.offer(edges, draw(at))),
    );
    yield* Effect.forkScoped(
      Stream.fromQueue(edges).pipe(
        Stream.switchMap((edge) =>
          edge === undefined
            ? Stream.empty
            : Stream.fromEffect(
                Effect.flatMap(Clock.currentTimeMillis, (now) =>
                  Effect.sleep(Duration.millis(Math.max(0, edge - now))),
                ),
              ),
        ),
        Stream.runForEach(() => drawn),
      ),
    );
    return drawn;
  });
}

export interface AnsweredCollection<Row extends object, Key extends string> {
  readonly collection: RowCollection<Row, Key>;
  readonly answer: (rows: readonly Row[]) => readonly Key[];
  readonly confirmRow: (key: Key, fields: (row: Row) => Partial<Row>) => void;
  readonly confirmGone: (key: Key) => void;
}

export function answeredCollection<Row extends object, Key extends string>(options: {
  readonly getKey: (row: Row) => Key;
}): Effect.Effect<AnsweredCollection<Row, Key>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const synced = yield* syncedCollection(options.getKey);
    const { collection, held, take } = synced;
    return {
      collection,
      answer: (rows: readonly Row[]) =>
        take(new Map(rows.map((row) => [options.getKey(row), row]))),
      confirmRow: (key: Key, fields: (row: Row) => Partial<Row>) => {
        const row = held().get(key);
        if (row !== undefined) take(new Map(held()).set(key, { ...row, ...fields(row) }));
      },
      confirmGone: (key: Key) => {
        if (!held().has(key)) return;
        const next = new Map(held());
        next.delete(key);
        take(next);
      },
    };
  });
}

export interface CarriedWaits<Row> {
  readonly answered: Effect.Effect<void>;
  readonly carried: (until: (rows: readonly Row[]) => boolean) => Effect.Effect<void>;
}

export function carriedWaits<Row>(
  answered: () => readonly Row[],
): Effect.Effect<CarriedWaits<Row>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const waits = new Map<Deferred.Deferred<void>, (rows: readonly Row[]) => boolean>();
    let open = true;
    const settle = (all: boolean) => {
      const rows = answered();
      for (const [settled, until] of waits) {
        if (!all && !until(rows)) continue;
        waits.delete(settled);
        Deferred.doneUnsafe(settled, Effect.void);
      }
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
        settle(true);
      }),
    );
    const carried = (until: (rows: readonly Row[]) => boolean) =>
      Effect.suspend(() => {
        if (!open || until(answered())) return Effect.void;
        const settled = Deferred.makeUnsafe<void>();
        waits.set(settled, until);
        return Deferred.await(settled).pipe(
          Effect.timeoutOption(TX_WAIT_TIMEOUT),
          Effect.flatMap((arrived) =>
            Option.isSome(arrived)
              ? Effect.void
              : Effect.logWarning("live-collection: a write's rows did not arrive on its read"),
          ),
          Effect.ensuring(Effect.sync(() => waits.delete(settled))),
        );
      });
    return { answered: Effect.sync(() => settle(false)), carried };
  });
}

export interface RowWritten<Row, Answer> {
  readonly answer: Answer;
  readonly txid: string | undefined;
  readonly fields?: Partial<Row> | typeof ROW_GONE;
}

export interface RowRefused<Answer> {
  readonly refused: Answer;
}

export type RowWrite<Row> = <Answer>(
  key: string,
  change: (row: Row) => Partial<Row> | typeof ROW_GONE,
  written: Effect.Effect<RowWritten<Row, Answer> | RowRefused<Answer>>,
) => Effect.Effect<Answer>;

export function rowWriteOn<Row extends object>(
  pool: EntityPool,
  kind: EntityKind<Row, FieldChange<Row>>,
): RowWrite<Row> {
  return (key, change, written) =>
    pool.write(
      {
        kind,
        keys: () => [key],
        change: () => change,
        send: () =>
          Effect.map(written, (result) => {
            if ("refused" in result) return result;
            const { answer, txid, fields } = result;
            return {
              answer,
              txid,
              ...(fields === undefined ? undefined : { taken: () => fields }),
            };
          }),
      },
      undefined,
    );
}

type AccountRead = (userId: string) => Effect.Effect<void>;

export interface AccountReads<Name extends string> {
  readonly open: (name: Name, read: AccountRead) => Effect.Effect<void>;
  readonly reopen: (name: Name, read: AccountRead) => Effect.Effect<void>;
  readonly end: Effect.Effect<void>;
}

export function accountReads<Name extends string>(
  accountId: () => string | undefined,
  ended: Effect.Effect<void>,
): Effect.Effect<AccountReads<Name>, never, Scope.Scope> {
  return Effect.map(FiberMap.make<Name>(), (reads) => {
    let session: string | undefined;
    const end = Effect.suspend(() => {
      if (session === undefined) return Effect.void;
      session = undefined;
      return Effect.andThen(FiberMap.clear(reads), ended);
    });
    const run = (name: Name, read: AccountRead, onlyIfMissing: boolean) =>
      Effect.gen(function* () {
        const userId = accountId();
        if (userId !== session) yield* end;
        if (userId === undefined) return;
        session = userId;
        yield* FiberMap.run(reads, name, read(userId), { onlyIfMissing });
      });
    return {
      open: (name, read) => run(name, read, true),
      reopen: (name, read) => run(name, read, false),
      end,
    };
  });
}

export const RECENT_READS = 8;

interface LetGo<Key> {
  readonly pause: boolean;
  readonly kept: (recent: readonly Key[]) => readonly Key[];
}

interface HeldReads<Key> {
  readonly hold: (key: Key) => Effect.Effect<void, never, Scope.Scope>;
  readonly held: (key: Key) => boolean;
  readonly reopen: (key: Key) => Effect.Effect<void>;
  readonly reopenHeld: Effect.Effect<void>;
  readonly drop: (which: (key: Key) => boolean) => Effect.Effect<void>;
  readonly end: Effect.Effect<void>;
}

function heldReads<Key>(
  read: (key: Key) => Effect.Effect<void>,
  closed: (key: Key) => Effect.Effect<void>,
  ended: Effect.Effect<void>,
  letGo: LetGo<Key> = { pause: false, kept: (recent) => recent.slice(-RECENT_READS) },
): Effect.Effect<HeldReads<Key>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const fibers = yield* FiberMap.make<Key>();
    const holders = MutableHashMap.empty<Key, number>();
    let recent: Key[] = [];
    const holdersOf = (key: Key) => Option.getOrElse(MutableHashMap.get(holders, key), () => 0);
    const notRecent = (key: Key) => recent.filter((other) => !Equal.equals(other, key));
    const close = (key: Key) => Effect.andThen(FiberMap.remove(fibers, key), closed(key));
    const release = (key: Key) =>
      Effect.gen(function* () {
        const left = holdersOf(key) - 1;
        if (left > 0) {
          MutableHashMap.set(holders, key, left);
          return;
        }
        MutableHashMap.remove(holders, key);
        recent = [...notRecent(key), key];
        if (letGo.pause) yield* FiberMap.remove(fibers, key);
        const kept = letGo.kept(recent);
        for (const gone of recent) {
          if (!kept.some((other) => Equal.equals(other, gone))) yield* close(gone);
        }
        recent = [...kept];
      });
    return {
      hold: (key) =>
        Effect.gen(function* () {
          MutableHashMap.set(holders, key, holdersOf(key) + 1);
          recent = notRecent(key);
          yield* FiberMap.run(fibers, key, read(key), { onlyIfMissing: true });
          yield* Effect.addFinalizer(() => release(key));
        }),
      held: (key) => holdersOf(key) > 0,
      reopen: (key) =>
        Effect.suspend(() =>
          holdersOf(key) > 0 || (!letGo.pause && recent.some((other) => Equal.equals(other, key)))
            ? FiberMap.run(fibers, key, read(key))
            : Effect.void,
        ),
      reopenHeld: Effect.suspend(() =>
        Effect.forEach(
          [...MutableHashMap.keys(holders)],
          (key) => FiberMap.run(fibers, key, read(key)),
          { discard: true },
        ),
      ),
      drop: (which) =>
        Effect.suspend(() => {
          const gone = recent.filter(which);
          recent = recent.filter((key) => !which(key));
          return Effect.forEach(gone, close, { discard: true });
        }),
      end: Effect.suspend(() => {
        recent = [];
        return Effect.andThen(FiberMap.clear(fibers), ended);
      }),
    };
  });
}

export type SliceKeyed = {
  [Slice in HostReadSlice &
    LiveRead]: (typeof HOST_READ_SLICE)[Slice]["on"] extends typeof KEYS_ON.SLICE ? Slice : never;
}[HostReadSlice & LiveRead];

export interface HeldAnswers<Rows> {
  readonly answered: (rows: Rows) => void;
  readonly unanswered: () => void;
  readonly retried: () => void;
  readonly rows: () => Rows | undefined;
}

export interface HeldSlice<Key> {
  readonly hold: HeldReads<Key>["hold"];
  readonly held: HeldReads<Key>["held"];
  readonly retry: (key: Key) => Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
  readonly drop: HeldReads<Key>["drop"];
  readonly end: Effect.Effect<void>;
}

export interface HeldBudget {
  readonly reads: number;
  readonly bytes: number;
  readonly bytesEach: number;
}

export interface HeldRows<Key, Rows> {
  readonly rowsOf: (key: Key) => Rows | undefined;
  readonly lay: (key: Key, rows: Rows) => void;
}

function withKeyLaid(keyed: object, path: readonly string[], read: object | undefined): object {
  const [id, ...below] = path;
  if (id === undefined) return keyed;
  const next: Record<string, unknown> = { ...keyed };
  if (below.length > 0) {
    const level: unknown = Object.hasOwn(keyed, id) ? Reflect.get(keyed, id) : undefined;
    next[id] = withKeyLaid(typeof level === "object" && level !== null ? level : {}, below, read);
  } else if (read === undefined) Reflect.deleteProperty(next, id);
  else next[id] = read;
  return next;
}

function readAt(keyed: object, path: readonly string[]): AppHostRead<unknown> | undefined {
  let level: unknown = keyed;
  for (const id of path) {
    level =
      typeof level === "object" && level !== null && Object.hasOwn(level, id)
        ? Reflect.get(level, id)
        : undefined;
  }
  return level as AppHostRead<unknown> | undefined;
}

const encoder = new TextEncoder();

export function heldSlice<Slice extends SliceKeyed, Key>(options: {
  readonly empty: AppState[Slice];
  readonly path: (key: Key) => HostReadKeyPath<Slice>;
  readonly gate: () => boolean;
  readonly follow: (key: Key, answers: HeldAnswers<AppHostReads[Slice]>) => Effect.Effect<void>;
  readonly tell: (slice: AppState[Slice]) => void;
  readonly pause?: boolean;
  readonly budget?: HeldBudget;
}): Effect.Effect<HeldSlice<Key> & HeldRows<Key, AppHostReads[Slice]>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let held = options.empty;
    const sizes = MutableHashMap.empty<Key, number>();
    const lay = (key: Key, read: AppHostRead<AppHostReads[Slice]> | undefined) => {
      held = withKeyLaid(held, options.path(key), read) as AppState[Slice];
      options.tell(held);
    };
    const readOf = (key: Key) => readAt(held, options.path(key));
    const answers = (key: Key): HeldAnswers<AppHostReads[Slice]> => ({
      answered: (rows) => lay(key, { rows }),
      unanswered: () => {
        if (readOf(key)?.rows === undefined) lay(key, { failed: true });
      },
      retried: () => {
        if (readOf(key)?.failed === true) lay(key, UNREAD);
      },
      rows: () => readOf(key)?.rows as AppHostReads[Slice] | undefined,
    });
    const sizeOf = (key: Key) =>
      Option.getOrElse(MutableHashMap.get(sizes, key), () => {
        const size = encoder.encode(JSON.stringify(readOf(key) ?? null)).byteLength;
        MutableHashMap.set(sizes, key, size);
        return size;
      });
    const budget = options.budget;
    const kept = (recent: readonly Key[]): readonly Key[] => {
      if (budget === undefined) return recent.slice(-RECENT_READS);
      const keeping: Key[] = [];
      let bytes = 0;
      for (const key of recent.toReversed()) {
        const size = sizeOf(key);
        if (size > budget.bytesEach) continue;
        if (keeping.length >= budget.reads || bytes + size > budget.bytes) break;
        keeping.push(key);
        bytes += size;
      }
      return keeping.toReversed();
    };
    const reads = yield* heldReads<Key>(
      (key) =>
        Effect.suspend(() => (options.gate() ? options.follow(key, answers(key)) : Effect.void)),
      (key) =>
        Effect.sync(() => {
          MutableHashMap.remove(sizes, key);
          lay(key, undefined);
        }),
      Effect.sync(() => {
        MutableHashMap.clear(sizes);
        held = options.empty;
        options.tell(held);
      }),
      { pause: options.pause === true, kept },
    );
    return {
      hold: (key) =>
        Effect.andThen(
          Effect.sync(() => MutableHashMap.remove(sizes, key)),
          reads.hold(key),
        ),
      held: reads.held,
      retry: (key) => Effect.andThen(Effect.sync(answers(key).retried), reads.reopen(key)),
      rowsOf: (key) => answers(key).rows(),
      lay: (key, rows) => {
        MutableHashMap.remove(sizes, key);
        lay(key, { rows });
      },
      open: reads.reopenHeld,
      drop: reads.drop,
      end: reads.end,
    };
  });
}
