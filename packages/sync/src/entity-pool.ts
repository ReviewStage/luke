import { Deferred, Effect, Equal, Exit, FiberSet, Result, Schema, Scope, Semaphore } from "effect";
import { rowOf, type SyncedCollection, syncedCollection } from "./synced-collection.js";

export const ROW_GONE: unique symbol = Symbol("the row is gone");

export const QUEUE_BOUND = 200;

export interface EntityKind<Row extends object, Change> {
  readonly key: (row: Row) => string;
  readonly drawn: (change: Change, row: Row | undefined) => Row | typeof ROW_GONE | undefined;
}

export interface MadeRow<Row> {
  readonly made: Row;
}

export type FieldChange<Row> = ((row: Row) => Partial<Row> | typeof ROW_GONE) | MadeRow<Row>;

export function fieldKind<Row extends object>(
  key: (row: Row) => string,
): EntityKind<Row, FieldChange<Row>> {
  return {
    key,
    drawn: (change, row) => {
      if (typeof change !== "function") return row === undefined ? change.made : undefined;
      if (row === undefined) return undefined;
      const fields = change(row);
      if (fields === ROW_GONE) return ROW_GONE;
      const moved = Object.entries(fields).some(
        ([name, value]) => !Equal.equals(Reflect.get(row, name), value),
      );
      return moved ? { ...row, ...fields } : undefined;
    },
  };
}

export type Confirmation = (txid: string) => Effect.Effect<void>;

export interface PoolRead<Row, Change = unknown> {
  readonly redraw: (keys: readonly string[]) => Effect.Effect<void>;
  readonly confirmation: () => Confirmation | undefined;
  readonly adopts?: (row: Row) => boolean;
  readonly beside?: {
    readonly shows: (key: string) => boolean;
    readonly take: (change: Change) => void;
  };
}

export interface HeldRows<Row extends object, Change = unknown> {
  readonly answer: (rows: readonly Row[], answered?: Answered) => Effect.Effect<readonly string[]>;
  readonly holds: (key: string) => boolean;
  readonly rows: () => readonly Row[];
  readonly row: (key: string) => Row | undefined;
  readonly pending: () => readonly string[];
  readonly synced: () => readonly Row[];
  readonly standing: () => readonly Change[];
}

export interface Answered {
  readonly held?: readonly string[];
  readonly at?: bigint;
}

export interface Written<Change, Answer> {
  readonly answer: Answer;
  readonly txid: string | undefined;
  readonly settled?: true;
  readonly taken?: Change;
  readonly standsAs?: Change;
  readonly carried?: Effect.Effect<void>;
}

export interface Refused<Answer, Change = never> {
  readonly refused: Answer;
  readonly unanswered?: true;
  readonly taken?: Change;
}

export interface QueuedWrite<Input, Answer> {
  readonly name: string;
  readonly input: Schema.Codec<Input, unknown>;
  readonly queued: (input: Input) => Answer;
  readonly holds?: (input: Input) => boolean;
}

export interface Sent {
  readonly key: string | undefined;
  readonly waited: boolean;
}

export interface QueuedEntry {
  readonly name: string;
  readonly key: string;
  readonly input: unknown;
}

export interface WriteDeclaration<Row extends object, Change, Input, Answer> {
  readonly kind: EntityKind<Row, Change>;
  readonly keys: (input: Input) => readonly string[];
  readonly change: (input: Input) => Change;
  readonly send: (
    input: Input,
    sent: Sent,
  ) => Effect.Effect<Written<Change, Answer> | Refused<Answer, Change>>;
  readonly queue?: QueuedWrite<Input, Answer>;
}

export type AnyWrite = <Result>(
  use: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
  ) => Result,
) => Result;

export function anyWrite<Row extends object, Change, Input, Answer>(
  declaration: WriteDeclaration<Row, Change, Input, Answer>,
): AnyWrite {
  return (use) => use(declaration);
}

export interface PoolOptions {
  readonly mintKey: () => string;
  readonly replayRefused: Effect.Effect<void>;
}

export interface EntityPool {
  readonly stand: <Row extends object, Change>(
    kind: EntityKind<Row, Change>,
    read: PoolRead<Row, Change>,
  ) => Effect.Effect<HeldRows<Row, Change>, never, Scope.Scope>;
  readonly write: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
    input: Input,
  ) => Effect.Effect<Answer>;
  readonly row: <Row extends object, Change>(
    kind: EntityKind<Row, Change>,
    key: string,
  ) => Row | undefined;
  readonly queued: () => readonly QueuedEntry[];
  readonly requeue: (
    entries: readonly QueuedEntry[],
    writes: readonly AnyWrite[],
  ) => Effect.Effect<void>;
  readonly resend: Effect.Effect<void>;
  readonly letGoQueued: Effect.Effect<void>;
}

interface Holding<Row, Change = unknown> {
  readonly read: PoolRead<Row, Change>;
  order: readonly string[];
  held: ReadonlySet<string>;
  adopted: ReadonlySet<string>;
}

interface Standing<Change> {
  readonly keys: readonly string[];
  change: Change;
}

interface Turn {
  readonly answered: Deferred.Deferred<void>;
  readonly dropped: Deferred.Deferred<void>;
}

const RETRIED = {
  KEPT: "kept",
  REFUSED: "refused",
  UNANSWERED: "unanswered",
} as const;

type Retried = (typeof RETRIED)[keyof typeof RETRIED];

interface Waiting {
  readonly entry: QueuedEntry;
  readonly retried: Effect.Effect<Retried>;
  readonly letGo: Effect.Effect<void>;
}

interface Queue {
  readonly options: PoolOptions | undefined;
  readonly confirming: FiberSet.FiberSet<void>;
  readonly lock: Semaphore.Semaphore;
  waiting: readonly Waiting[];
}

interface KindRows<Row extends object, Change> {
  readonly kind: EntityKind<Row, Change>;
  readonly synced: SyncedCollection<Row, string>;
  readonly reads: Set<Holding<Row, Change>>;
  standing: readonly Standing<Change>[];
  readonly lastWrites: Map<string, Turn>;
  readonly takenAt: Map<string, bigint>;
}

function drawnRow<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  key: string,
): Row | undefined {
  const stored = rows.synced.collection.get(key);
  let row = stored === undefined ? undefined : rowOf<Row>(stored);
  for (const write of rows.standing) {
    if (!write.keys.includes(key)) continue;
    const drawn = rows.kind.drawn(write.change, row);
    if (drawn === ROW_GONE) row = undefined;
    else if (drawn !== undefined) row = drawn;
  }
  return row;
}

function shows<Row, Change>(holding: Holding<Row, Change>, key: string): boolean {
  return (
    holding.held.has(key) || holding.adopted.has(key) || holding.read.beside?.shows(key) === true
  );
}

function shown<Row, Change>(holding: Holding<Row, Change>): readonly string[] {
  return [...holding.order, ...[...holding.adopted].filter((key) => !holding.held.has(key))];
}

function heldByAny<Row, Change>(reads: ReadonlySet<Holding<Row, Change>>, key: string): boolean {
  return [...reads].some((holding) => holding.held.has(key));
}

function holdersOf<Row, Change>(
  reads: ReadonlySet<Holding<Row, Change>>,
  keys: readonly string[],
  except?: Holding<Row, Change>,
): readonly Holding<Row, Change>[] {
  return [...reads].filter(
    (holding) => holding !== except && keys.some((key) => shows(holding, key)),
  );
}

function redrawn<Row, Change>(
  holdings: readonly Holding<Row, Change>[],
  keys: readonly string[],
): Effect.Effect<void> {
  if (keys.length === 0) return Effect.void;
  return Effect.forEach(holdings, (holding) => holding.read.redraw(keys), { discard: true });
}

function standingOver<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  key: string,
): boolean {
  return rows.standing.some((write) => write.keys.includes(key));
}

function movedBy<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  keys: readonly string[],
  step: () => void,
): Effect.Effect<void> {
  const before = keys.map((key) => [drawnRow(rows, key), standingOver(rows, key)] as const);
  const showing = holdersOf(rows.reads, keys);
  step();
  const moved = keys.filter(
    (key, at) => !Equal.equals(before[at], [drawnRow(rows, key), standingOver(rows, key)] as const),
  );
  if (moved.length === 0) return Effect.void;
  return redrawn([...new Set([...showing, ...holdersOf(rows.reads, moved)])], moved);
}

function adopted<Row extends object, Change>(rows: KindRows<Row, Change>, keys: readonly string[]) {
  for (const key of keys) {
    const row = drawnRow(rows, key);
    if (row === undefined) continue;
    for (const holding of rows.reads) {
      if (shows(holding, key) || holding.read.adopts?.(row) !== true) continue;
      holding.adopted = new Set([...holding.adopted, key]);
    }
  }
}

function unadopted<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  keys: readonly string[],
) {
  const loose = keys.filter((key) => !standingOver(rows, key));
  for (const holding of rows.reads) {
    if (!loose.some((key) => holding.adopted.has(key))) continue;
    holding.adopted = new Set([...holding.adopted].filter((key) => !loose.includes(key)));
  }
}

function takenAndDrawn<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  next: ReadonlyMap<string, Row>,
  except?: Holding<Row, Change>,
): Effect.Effect<readonly string[]> {
  return Effect.suspend(() => {
    const written = rows.synced.take(next);
    return Effect.as(redrawn(holdersOf(rows.reads, written, except), written), written);
  });
}

function awaitEach(
  turns: readonly Turn[],
  of: (turn: Turn) => Deferred.Deferred<void>,
): Effect.Effect<void> {
  return Effect.forEach(turns, (turn) => Deferred.await(of(turn)), { discard: true });
}

function stood<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  read: PoolRead<Row, Change>,
): Effect.Effect<HeldRows<Row, Change>, never, Scope.Scope> {
  const release = (holding: Holding<Row, Change>) =>
    Effect.sync(() => {
      rows.reads.delete(holding);
      const next = new Map(rows.synced.held());
      for (const key of holding.order) {
        if (heldByAny(rows.reads, key)) continue;
        next.delete(key);
        rows.takenAt.delete(key);
      }
      rows.synced.take(next);
    });
  return Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => {
        const holding: Holding<Row, Change> = {
          read,
          order: [],
          held: new Set(),
          adopted: new Set(),
        };
        rows.reads.add(holding);
        return holding;
      }),
      release,
    ),
    (holding): HeldRows<Row, Change> => ({
      answer: (answered, { held, at } = {}) =>
        Effect.suspend(() => {
          const keyed = new Map(answered.map((row) => [rows.kind.key(row), row]));
          const keys = new Set(held ?? keyed.keys());
          const was = holding.held;
          holding.order = [...keys];
          holding.held = keys;
          const next = new Map(rows.synced.held());
          for (const [key, row] of keyed) {
            const taken = rows.takenAt.get(key);
            if (at !== undefined && taken !== undefined && taken > at) continue;
            next.set(key, row);
            if (at !== undefined) rows.takenAt.set(key, at);
          }
          for (const key of was) {
            if (heldByAny(rows.reads, key)) continue;
            next.delete(key);
            rows.takenAt.delete(key);
          }
          const placed = [
            ...[...keys].filter((key) => !was.has(key)),
            ...[...was].filter((key) => !keys.has(key)),
          ];
          return Effect.map(takenAndDrawn(rows, next, holding), (written) => [
            ...new Set([...written, ...placed]),
          ]);
        }),
      holds: (key) => shows(holding, key),
      rows: () => shown(holding).flatMap((key) => drawnRow(rows, key) ?? []),
      row: (key) =>
        holding.held.has(key) || holding.adopted.has(key) ? drawnRow(rows, key) : undefined,
      pending: () => shown(holding).filter((key) => standingOver(rows, key)),
      synced: () => {
        const synced = rows.synced.held();
        return holding.order.flatMap((key) => synced.get(key) ?? []);
      },
      standing: () => rows.standing.map((write) => write.change),
    }),
  );
}

function takenInPlace<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  holdings: readonly Holding<Row, Change>[],
  keys: readonly string[],
  taken: Change,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    const next = new Map(rows.synced.held());
    const beside: Holding<Row, Change>[] = [];
    for (const holding of holdings) {
      if (keys.some((key) => holding.read.beside?.shows(key) === true)) beside.push(holding);
      for (const key of keys) {
        if (!holding.held.has(key) && !holding.adopted.has(key)) continue;
        const drawn = rows.kind.drawn(taken, next.get(key));
        if (drawn === ROW_GONE) {
          next.delete(key);
          rows.takenAt.delete(key);
        } else if (drawn !== undefined) next.set(key, drawn);
        if (holding.held.has(key) || !next.has(key)) continue;
        holding.order = [...holding.order, key];
        holding.held = new Set([...holding.held, key]);
      }
    }
    for (const holding of beside) holding.read.beside?.take(taken);
    return Effect.andThen(redrawn(beside, keys), takenAndDrawn(rows, next));
  });
}

function confirmedOn<Row extends object, Change, Answer>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  write: Standing<Change>,
  written: Written<Change, Answer>,
  earlier: Effect.Effect<void>,
): Effect.Effect<void> {
  const wait = holding.read.confirmation();
  if (wait !== undefined && written.txid !== undefined) return wait(written.txid);
  const taken = takenInPlace(rows, [holding], write.keys, written.taken ?? write.change);
  if (written.carried === undefined) return taken;
  return Effect.andThen(written.carried, Effect.andThen(earlier, taken));
}

function resent(queue: Queue): Effect.Effect<void> {
  return queue.lock.withPermits(1)(
    Effect.gen(function* () {
      for (;;) {
        const next = queue.waiting[0];
        if (next === undefined) return;
        const retried = yield* next.retried;
        if (retried === RETRIED.UNANSWERED) return;
        queue.waiting = queue.waiting.filter((each) => each !== next);
        if (retried === RETRIED.REFUSED) yield* queue.options?.replayRefused ?? Effect.void;
      }
    }),
  );
}

function written<Row extends object, Change, Input, Answer>(
  rows: KindRows<Row, Change>,
  queue: Queue,
  declaration: WriteDeclaration<Row, Change, Input, Answer>,
  input: Input,
  restored?: string,
): Effect.Effect<Answer> {
  return Effect.gen(function* () {
    const keys = [...new Set(declaration.keys(input))];
    const write: Standing<Change> = { keys, change: declaration.change(input) };
    const turn: Turn = {
      answered: yield* Deferred.make<void>(),
      dropped: yield* Deferred.make<void>(),
    };
    const before = [...new Set(keys.flatMap((key) => rows.lastWrites.get(key) ?? []))];
    for (const key of keys) rows.lastWrites.set(key, turn);
    const drawnOn = movedBy(rows, keys, () => {
      rows.standing = [...rows.standing, write];
      adopted(rows, keys);
    });
    const drop = Effect.suspend(() => {
      for (const key of keys) if (rows.lastWrites.get(key) === turn) rows.lastWrites.delete(key);
      return movedBy(rows, keys, () => {
        rows.standing = rows.standing.filter((each) => each !== write);
        unadopted(rows, keys);
      });
    }).pipe(Effect.ensuring(Deferred.succeed(turn.dropped, undefined)));
    const plan = declaration.queue;
    const mintKey = queue.options?.mintKey;
    const key = plan === undefined || mintKey === undefined ? undefined : (restored ?? mintKey());
    const entry =
      plan === undefined || key === undefined
        ? undefined
        : Result.getOrUndefined(
            Result.map(Schema.encodeResult(plan.input)(input), (kept) => ({
              name: plan.name,
              key,
              input: kept,
            })),
          );
    const attempt = (waited: boolean) =>
      Effect.suspend(() => declaration.send(input, { key, waited }));
    const sent = Effect.gen(function* () {
      yield* drawnOn;
      yield* awaitEach(before, (each) => each.answered);
      return yield* attempt(false);
    }).pipe(Effect.ensuring(Deferred.succeed(turn.answered, undefined)));
    const settled = (kept: Written<Change, Answer>) =>
      Effect.gen(function* () {
        const { standsAs } = kept;
        if (kept.settled !== true && standsAs !== undefined) {
          yield* movedBy(rows, keys, () => {
            write.change = standsAs;
          });
        }
        if (kept.settled !== true) {
          yield* Effect.forEach(
            holdersOf(rows.reads, keys),
            (holding) =>
              confirmedOn(
                rows,
                holding,
                write,
                kept,
                awaitEach(before, (each) => each.dropped),
              ),
            { concurrency: "unbounded", discard: true },
          );
        }
        yield* awaitEach(before, (each) => each.dropped);
      }).pipe(Effect.ensuring(drop));
    const takenBack = (refused: Refused<Answer, Change>) =>
      Effect.gen(function* () {
        const { taken } = refused;
        if (taken !== undefined) {
          yield* takenInPlace(rows, holdersOf(rows.reads, keys), keys, taken);
        }
        yield* drop;
      });
    const heard = yield* Deferred.make<Answer>();
    const waits = (kept: QueuedEntry, meanwhile: Answer) =>
      Effect.sync(() => {
        const waiting: Waiting = {
          entry: kept,
          retried: Effect.gen(function* () {
            const answered = yield* attempt(true);
            if ("refused" in answered) {
              if (answered.unanswered === true) return RETRIED.UNANSWERED;
              yield* takenBack(answered);
              yield* Deferred.succeed(heard, answered.refused);
              return RETRIED.REFUSED;
            }
            yield* FiberSet.run(queue.confirming, settled(answered));
            yield* Deferred.succeed(heard, answered.answer);
            return RETRIED.KEPT;
          }),
          letGo: Effect.andThen(drop, Deferred.succeed(heard, meanwhile)),
        };
        queue.waiting = [...queue.waiting, waiting];
      });
    const room = () => queue.waiting.length < QUEUE_BOUND;
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const heardAs = (waiting: QueuedWrite<Input, Answer>) =>
          waiting.holds?.(input) === true && restored === undefined
            ? restore(Deferred.await(heard))
            : Effect.succeed(waiting.queued(input));
        if (plan !== undefined && entry !== undefined && room()) {
          if (restored !== undefined || queue.waiting.length > 0) {
            yield* drawnOn;
            yield* Deferred.succeed(turn.answered, undefined);
            yield* waits(entry, plan.queued(input));
            if (restored === undefined) yield* FiberSet.run(queue.confirming, resent(queue));
            return yield* heardAs(plan);
          }
        }
        const answered = yield* Effect.onExit(restore(sent), (exit) =>
          Exit.isSuccess(exit) ? Effect.void : drop,
        );
        if ("refused" in answered) {
          if (answered.unanswered === true && plan !== undefined && entry !== undefined && room()) {
            yield* waits(entry, plan.queued(input));
            return yield* heardAs(plan);
          }
          yield* takenBack(answered);
          return answered.refused;
        }
        yield* FiberSet.run(queue.confirming, settled(answered));
        return answered.answer;
      }),
    );
  });
}

function requeued(
  entries: readonly QueuedEntry[],
  writes: readonly AnyWrite[],
  rewritten: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
    input: Input,
    key: string,
  ) => Effect.Effect<void>,
): Effect.Effect<void> {
  const byName = new Map(
    writes.flatMap((each) =>
      each((declaration) =>
        declaration.queue === undefined ? [] : [[declaration.queue.name, each] as const],
      ),
    ),
  );
  return Effect.forEach(
    entries,
    (entry) => {
      const named = byName.get(entry.name);
      if (named === undefined) return Effect.void;
      return named((declaration) => {
        const plan = declaration.queue;
        if (plan === undefined) return Effect.void;
        const input = Result.getOrUndefined(Schema.decodeUnknownResult(plan.input)(entry.input));
        return input === undefined ? Effect.void : rewritten(declaration, input, entry.key);
      });
    },
    { discard: true },
  );
}

export function entityPool(options?: PoolOptions): Effect.Effect<EntityPool, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const queue: Queue = {
      options,
      confirming: yield* FiberSet.make<void>(),
      lock: yield* Semaphore.make(1),
      waiting: [],
    };
    const kinds = new Map<object, unknown>();
    const rowsOf = <Row extends object, Change>(
      kind: EntityKind<Row, Change>,
    ): Effect.Effect<KindRows<Row, Change>> =>
      Effect.suspend(() => {
        const made = () => kinds.get(kind) as KindRows<Row, Change> | undefined;
        const standing = made();
        if (standing !== undefined) return Effect.succeed(standing);
        return Effect.map(Scope.provide(scope)(syncedCollection(kind.key)), (synced) => {
          const raced = made();
          if (raced !== undefined) return raced;
          const fresh: KindRows<Row, Change> = {
            kind,
            synced,
            reads: new Set(),
            standing: [],
            lastWrites: new Map(),
            takenAt: new Map(),
          };
          kinds.set(kind, fresh);
          return fresh;
        });
      });
    return {
      stand: (kind, read) => Effect.flatMap(rowsOf(kind), (rows) => stood(rows, read)),
      write: (declaration, input) =>
        Effect.flatMap(rowsOf(declaration.kind), (rows) =>
          written(rows, queue, declaration, input),
        ),
      row: <Row extends object, Change>(kind: EntityKind<Row, Change>, key: string) => {
        const rows = kinds.get(kind) as KindRows<Row, Change> | undefined;
        return rows === undefined ? undefined : drawnRow(rows, key);
      },
      queued: () => queue.waiting.map((each) => each.entry),
      requeue: (entries, writes) =>
        requeued(entries, writes, (declaration, input, key) =>
          Effect.asVoid(
            Effect.flatMap(rowsOf(declaration.kind), (rows) =>
              written(rows, queue, declaration, input, key),
            ),
          ),
        ),
      resend: Effect.suspend(() => resent(queue)),
      letGoQueued: Effect.suspend(() => {
        const waiting = queue.waiting;
        queue.waiting = [];
        return Effect.forEach(waiting, (each) => each.letGo, { discard: true });
      }),
    };
  });
}
