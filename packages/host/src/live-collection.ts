/**
 * live-collection.ts -- the host's TanStack DB collections: each fed, whole and by key, the rows a followed read answers, and changed over them by a write drawn the moment it is asked.
 *
 * A read the host follows answers every row it shows each time any moves
 * (`live-follow.ts`). Its collection takes each answer by key, one sync
 * transaction writing an insert, an update, or a delete for each row that
 * moved and nothing for the rest, so a reader of it hears only what moved.
 * Note that it never truncates, because TanStack's truncate deletes every
 * row and inserts it again, moved or not.
 *
 * A write is drawn over the collections it changes the moment it is asked,
 * as an optimistic transaction, and stands until its work settles: kept
 * where the work succeeds, by when the read carries it, and taken back
 * where it fails. While it stands, what the read answers for those
 * collections is held, and lands with the drop of what the write drew, so
 * nothing flickers back between the two. TanStack takes the work as a
 * promise, so this is the one door between the two: the work runs on the
 * caller's own fiber, and the promise TanStack holds is only the wait for
 * it to settle, run on the services the caller handed it.
 *
 * Every collection here lives for as long as the scope that made it,
 * never by TanStack's own timer: `gcTime` 0 turns that timer off and the
 * scope's close cleans the collection up, so a test's clock stays its own.
 */

import {
  type Collection,
  createCollection,
  createTransaction,
  type SyncConfig,
  type UtilsRecord,
  type WithoutVirtualProps,
} from "@tanstack/db";
import { Cause, type Context, Deferred, Effect, Equal, Exit, type Scope } from "effect";

/** TanStack's own garbage collection turned off, so a collection, or a live query, lives as long as the scope that made it. */
export const KEPT_BY_SCOPE = 0;

/** A collection of `Row`s keyed by `Key`, made with no schema of TanStack's, since a row is decoded by Effect's at the boundary. */
type RowCollection<Row extends object, Key extends string> = Collection<
  Row,
  Key,
  UtilsRecord,
  never
>;

/** One change to a row: a new row, a row replaced whole, or a row gone by its key. */
type RowChange<Row extends object, Key extends string> =
  | { readonly type: "insert"; readonly value: Row }
  | { readonly type: "update"; readonly value: Row }
  | { readonly type: "delete"; readonly key: Key };

/** What a sync config is handed to write a collection's synced rows with. */
type SyncWriter<Row extends object, Key extends string> = Parameters<
  SyncConfig<Row, Key>["sync"]
>[0];

/**
 * The changes that take `held` to `next`: a delete for each key gone, an
 * insert for each new one, and an update, the row whole, for each that
 * moved; none for a row that did not.
 */
function rowChanges<Row extends object, Key extends string>(
  held: ReadonlyMap<Key, Row>,
  next: ReadonlyMap<Key, Row>,
): RowChange<Row, Key>[] {
  const gone = [...held.keys()]
    .filter((key) => !next.has(key))
    .map((key) => ({ type: "delete" as const, key }));
  const moved = [...next].flatMap(([key, row]): RowChange<Row, Key>[] => {
    const was = held.get(key);
    if (was === undefined) return [{ type: "insert", value: row }];
    return Equal.equals(was, row) ? [] : [{ type: "update", value: row }];
  });
  return [...gone, ...moved];
}

/**
 * A row as the collection holds it, without the virtual fields TanStack
 * reads it out with (`$synced`, `$origin`, and the rest) and without a key a
 * whole-row change left undefined, so it is the row as the read answered it.
 */
function rowOf<Row extends object>(stored: object): Row {
  // SAFETY: only the virtual fields and keys left undefined are dropped, neither of which a row of ours carries.
  return Object.fromEntries(
    Object.entries(stored).filter(([name, value]) => !name.startsWith("$") && value !== undefined),
  ) as Row;
}

/** Every row a collection, or a live query, shows now, what a standing write drew among them. */
export function rowsOf<Row extends object>(collection: {
  readonly toArray: readonly Row[];
}): WithoutVirtualProps<Row>[] {
  return collection.toArray.map((stored) => rowOf<WithoutVirtualProps<Row>>(stored));
}

/**
 * Draws `rows` over a collection inside a write's transaction: an insert, a
 * whole-row update, or a delete for each row that differs from what it
 * shows, and nothing for the rest.
 */
export function drawRows<Row extends object, Key extends string>(
  collection: RowCollection<Row, Key>,
  rows: readonly Row[],
): void {
  const keyed = (each: readonly Row[]) =>
    new Map(each.map((row) => [collection.getKeyFromItem(row), row]));
  const shown = collection.toArray.map((stored) => rowOf<Row>(stored));
  for (const change of rowChanges(keyed(shown), keyed(rows))) {
    if (change.type === "delete") collection.delete(change.key);
    else if (change.type === "insert") collection.insert(change.value);
    else
      collection.update(collection.getKeyFromItem(change.value), (draft) => {
        // Note that a key the row no longer carries is left undefined, which `rowOf` drops, since a draft keeps its keys.
        for (const name of Object.keys(draft)) {
          if (!name.startsWith("$") && !(name in change.value)) Reflect.deleteProperty(draft, name);
        }
        Object.assign(draft, change.value);
      });
  }
}

/** `make`'s collection, or live query, kept until the scope closes, which cleans it up. */
export function scopedCollection<Made extends { cleanup(): Promise<void> }>(
  make: () => Made,
): Effect.Effect<Made, never, Scope.Scope> {
  return Effect.acquireRelease(Effect.sync(make), (made) => Effect.promise(() => made.cleanup()));
}

/** A collection a followed read answers whole, and the door its answers come in by. */
export interface AnsweredCollection<Row extends object, Key extends string> {
  readonly collection: RowCollection<Row, Key>;
  /**
   * Takes the rows the read answered, whole: one sync transaction writing
   * each that moved, or none where nothing did. While a write on the
   * collection stands, the transaction is held, and lands with its drop.
   */
  readonly answer: (rows: readonly Row[]) => void;
  /**
   * Takes what a write's own answer says of one row in the read's place,
   * where the read can confirm no write yet: the row as the read last
   * answered it, with the `fields` it gives laid over it. A row the read
   * never answered is left alone.
   */
  readonly confirmRow: (key: Key, fields: (row: Row) => Partial<Row>) => void;
  /** Takes a write's own answer that one row is gone in the read's place, as `confirmRow` takes a change. */
  readonly confirmGone: (key: Key) => void;
}

/** A collection of rows keyed by `getKey`, ready and empty until its read first answers, for as long as the scope stands. */
export function answeredCollection<Row extends object, Key extends string>(options: {
  readonly getKey: (row: Row) => Key;
}): Effect.Effect<AnsweredCollection<Row, Key>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let writer: SyncWriter<Row, Key> | undefined;
    let held: ReadonlyMap<Key, Row> = new Map();
    const collection = yield* scopedCollection(() =>
      createCollection<Row, Key>({
        getKey: options.getKey,
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        sync: {
          rowUpdateMode: "full",
          sync: (handed) => {
            writer = handed;
            handed.begin();
            handed.commit();
            handed.markReady();
            return () => {
              writer = undefined;
            };
          },
        },
      }),
    );
    const answer = (rows: readonly Row[]) =>
      taken(new Map(rows.map((row) => [options.getKey(row), row])));
    const confirmRow = (key: Key, fields: (row: Row) => Partial<Row>) => {
      const row = held.get(key);
      if (row !== undefined) taken(new Map(held).set(key, { ...row, ...fields(row) }));
    };
    const confirmGone = (key: Key) => {
      if (!held.has(key)) return;
      const next = new Map(held);
      next.delete(key);
      taken(next);
    };
    /** Takes the rows `next` holds as the synced ones, one transaction writing each that moved. */
    function taken(next: ReadonlyMap<Key, Row>): void {
      const changes = rowChanges(held, next);
      if (writer === undefined || changes.length === 0) return;
      writer.begin();
      for (const change of changes) writer.write(change);
      // Note that the receipt is never awaited, since a commit held behind a standing write lands only once that write settles.
      writer.commit();
      held = next;
    }
    return { collection, answer, confirmRow, confirmGone };
  });
}

/**
 * The promise TanStack waits on before it keeps or takes back a write: the
 * work's settling, run on the services the caller handed it, failing as the
 * work failed so the write is taken back.
 */
function settling<E>(
  services: Context.Context<never>,
  settled: Deferred.Deferred<void, E>,
): Promise<void> {
  return Effect.runPromiseExitWith(services)(Deferred.await(settled)).then((exit) => {
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  });
}

/**
 * `work`, with what `draw` changes in the collections drawn over them from
 * now until `work` settles: kept where it succeeds, taken back where it
 * fails or is interrupted, and answered only once TanStack has done either.
 * Where `draw` changed nothing, nothing stands and `work` runs alone.
 */
export function optimistically<A, E>(
  draw: () => void,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const settled = yield* Deferred.make<void, E>();
    const transaction = createTransaction<Record<string, unknown>>({
      autoCommit: true,
      mutationFn: () => settling(services, settled),
    });
    transaction.mutate(draw);
    if (transaction.mutations.length === 0) return yield* work;
    const kept = () =>
      transaction.isPersisted.promise.then(
        () => undefined,
        () => undefined,
      );
    return yield* Effect.onExit(work, (exit) =>
      Effect.andThen(Deferred.done(settled, Exit.asVoid(exit)), Effect.promise(kept)),
    );
  });
}
