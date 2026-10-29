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
 * How long a read's scope stands is its lifetime class, declared here once
 * rather than by each read: an account read (`accountReads`) stands for the
 * signed-in session.
 */

import {
  type Collection,
  createCollection,
  createTransaction,
  type SyncConfig,
  type UtilsRecord,
  type WithoutVirtualProps,
} from "@tanstack/db";
import {
  Cause,
  Clock,
  type Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Equal,
  Exit,
  FiberMap,
  Queue,
  type Scope,
  Stream,
} from "effect";
import { confirmWrite, type TxWait } from "./live-follow.js";

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

/**
 * `draw`, at the host's own instant, as the returned effect asks, and again
 * at the instant each draw answers the clock alone next moves what it drew,
 * for as long as the scope stands, the wait for an edge drawn since
 * replacing the wait for the one before. Note that a live query reads no
 * clock, so what moves with the clock is built here, from its rows.
 */
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
  /**
   * Takes a write's own answer of a row it made in the read's place, as
   * `confirmRow` takes a change. A row the read answered already is left as
   * it answered it, which is as new.
   */
  readonly confirmNew: (row: Row) => void;
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
    const confirmNew = (row: Row) => {
      const key = options.getKey(row);
      if (!held.has(key)) taken(new Map(held).set(key, row));
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
    return { collection, answer, confirmRow, confirmGone, confirmNew };
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

/**
 * What a write's service call answered: the caller's own answer, the
 * transaction it committed in, and the row's fields as the service then
 * holds them, or that it is gone, taken in the read's place where it hands
 * no wait; where the answer says none of them, the fields the write drew
 * are taken instead.
 */
export interface RowWritten<Row, Answer> {
  readonly answer: Answer;
  readonly txid: string | undefined;
  readonly fields?: Partial<Row> | typeof ROW_GONE;
}

/** What a write leaves of a row that it takes out of the read, as a task deleted is. */
export const ROW_GONE: unique symbol = Symbol("the row is gone");

/** A write the service refused, which takes back what it drew, and what the caller answers for it. */
export interface RowRefused<Answer> {
  readonly refused: Answer;
}

/** A write the service did not answer, which takes back what it drew. */
class Unwritten extends Data.TaggedError("Unwritten") {}

/**
 * A write to one row: what the row's fields become, from the row as it is
 * drawn now, or that it is gone, and the service call that writes it,
 * answering what the caller answers either way.
 */
export type RowWrite<Row> = <Answer>(
  key: string,
  change: (row: Row) => Partial<Row> | typeof ROW_GONE,
  written: Effect.Effect<RowWritten<Row, Answer> | RowRefused<Answer>>,
) => Effect.Effect<Answer>;

/**
 * The writes to one collection's rows, each drawn at once and standing
 * while the service writes it: kept once the followed read carries its
 * transaction, and taken back where the service refused it. Where the read
 * hands no wait yet, the row as the write's own answer leaves it is taken
 * in the read's place. Either lands with the drop of what was drawn, so
 * nothing flickers back between the two. Writes to one row go to the
 * service in the order asked, each row's newest settling the next write to
 * it waits on, since each was drawn over the ones before. `drawn` draws the
 * read as it stands, as each write begins and once it settles.
 */
export function rowWrites<Row extends object>(
  collection: AnsweredCollection<Row, string>,
  options: {
    readonly drawn: Effect.Effect<void>;
    /** The followed read's wait for a write's transaction; none while the follow hands none. */
    readonly txWait: () => TxWait | undefined;
  },
): RowWrite<Row> {
  const { drawn } = options;
  const lastWrites = new Map<string, Deferred.Deferred<void>>();
  /** Confirms a write on the followed read where it hands a wait, or takes the write's own answer in its place where it does not. */
  const confirmed = (txid: string | undefined, answered: () => void) => {
    const wait = options.txWait();
    return wait === undefined || txid === undefined
      ? Effect.sync(answered)
      : confirmWrite(wait, txid);
  };
  return <Answer>(
    key: string,
    change: (row: Row) => Partial<Row> | typeof ROW_GONE,
    written: Effect.Effect<RowWritten<Row, Answer> | RowRefused<Answer>>,
  ) =>
    Effect.gen(function* () {
      const before = lastWrites.get(key);
      const settled = yield* Deferred.make<void>();
      lastWrites.set(key, settled);
      const answered: { value?: Answer } = {};
      const draw = () => {
        const row = collection.collection.get(key);
        if (row === undefined) return;
        const fields = change(row);
        if (fields === ROW_GONE) collection.collection.delete(key);
        else collection.collection.update(key, (draft) => Object.assign(draft, fields));
      };
      const work = Effect.gen(function* () {
        yield* drawn;
        if (before !== undefined) yield* Deferred.await(before);
        const result = yield* written;
        if ("refused" in result) {
          answered.value = result.refused;
          return yield* new Unwritten();
        }
        answered.value = result.answer;
        yield* confirmed(result.txid, () => {
          const { fields } = result;
          if (fields === ROW_GONE) collection.confirmGone(key);
          else
            collection.confirmRow(key, (row) => {
              const drawnFields = fields ?? change(row);
              return drawnFields === ROW_GONE ? {} : drawnFields;
            });
        });
      });
      yield* optimistically(draw, work).pipe(
        Effect.catchTag("Unwritten", () => Effect.void),
        Effect.ensuring(drawn),
        Effect.ensuring(
          Effect.andThen(
            Deferred.succeed(settled, undefined),
            Effect.sync(() => {
              if (lastWrites.get(key) === settled) lastWrites.delete(key);
            }),
          ),
        ),
      );
      // SAFETY: the work sets the answer before it settles, whether the service wrote or refused the row.
      return answered.value as Answer;
    });
}

/**
 * The reads that stand for the signed-in session, as the Inbox's feed does:
 * each opened once for the account signed in, by its name, and every one
 * closed together when the session ends, so no read handles a sign-out or
 * an account switch itself.
 */
export interface AccountReads<Name extends string> {
  /** Opens `name`'s read for the account signed in unless it stands for it already, closing the last account's reads first; nothing while nobody is signed in. */
  readonly open: (name: Name, read: (userId: string) => Effect.Effect<void>) => Effect.Effect<void>;
  /** Opens `name`'s read again at once, as Try again asks, rather than waiting on its own restart. */
  readonly reopen: (
    name: Name,
    read: (userId: string) => Effect.Effect<void>,
  ) => Effect.Effect<void>;
  /** Closes every read: the session ended, by a sign-out or another account signing in. */
  readonly end: Effect.Effect<void>;
}

/**
 * The account lifetime for the account `accountId` names now, its reads
 * closed with the caller's scope; `ended` runs once a session's reads are
 * closed, so what they drew is let go before the next account's draw.
 */
export function accountReads<Name extends string>(
  accountId: () => string | undefined,
  ended: Effect.Effect<void>,
): Effect.Effect<AccountReads<Name>, never, Scope.Scope> {
  return Effect.map(FiberMap.make<Name>(), (reads) => {
    /** The account every standing read is for; none while none stands. */
    let session: string | undefined;
    const end = Effect.suspend(() => {
      if (session === undefined) return Effect.void;
      session = undefined;
      return Effect.andThen(FiberMap.clear(reads), ended);
    });
    const run = (
      name: Name,
      read: (userId: string) => Effect.Effect<void>,
      onlyIfMissing: boolean,
    ) =>
      Effect.gen(function* () {
        const userId = accountId();
        // Note that another account's reads are closed before this one's opens, so nothing it drew reaches the next.
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
