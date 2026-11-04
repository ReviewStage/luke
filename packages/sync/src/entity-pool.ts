/**
 * entity-pool.ts -- every row the host's reads hold, once, by kind and key: each read stands on the keys it answered, and a write is drawn over a row once and reaches every read that holds it the moment it is asked.
 *
 * A kind is declared by its client (`EntityKind`): a row's key, and how a
 * change of the kind is drawn over a row. The pool keeps each kind's rows in
 * one collection only sync writes (`synced-collection.ts`), made the first
 * time a read stands on the kind or a write names it, for as long as the pool
 * stands. A read stands on a kind for its own scope: each answer upserts its
 * rows and replaces the keys it holds, a key no read holds any longer leaves
 * in the same commit, and every other read holding a row that moved is drawn
 * again. As the read's scope closes its keys are let go, and so is any row no
 * other read holds, so one account's rows never reach the next account's
 * reads.
 *
 * A write (`WriteDeclaration`) names its kind, the keys it changes, the
 * change, and how it is sent. It is laid over the rows the moment it is
 * asked, as the newest of the writes standing, and every read holding one of
 * its keys is drawn again; a read shows each row as the synced one with every
 * write standing on it drawn over it, in the order asked. Note that a write
 * is never a TanStack transaction, because a persisting transaction holds
 * back every answer its collection is synced, so one write would freeze
 * every read of its kind; here an answer lands at once and the writes
 * standing are drawn over it. So a change is drawn again over each row taken
 * while it stands, and must leave a row the service already changed as it
 * is.
 *
 * A write goes to the service once every write to its keys asked before it
 * has been answered, so the service takes them in the order asked. It
 * answers its caller as soon as the service does, and goes on standing until
 * each read holding its keys carries its transaction, through the wait that
 * read hands in (`Confirmation`); where a read hands none, what the service
 * answered is taken in that read's place, and where the service answered no
 * transaction, the write stands until its own wait for its reads settles
 * first, where it hands one (`Written.carried`). Writes to one key stand down in the
 * order asked, so an older one never stands over a newer one the reads
 * already carry. From the service's answer on, a write may stand as what the
 * service said of its rows (`Written.standsAs`), as an inbox item answered
 * with its reply does. A write the service refused is taken back before its
 * caller hears so, on the service's word where it gave one, and the caller
 * says so, as a toast does.
 *
 * A read that keeps rows of another shape stands beside the pool
 * (`PoolRead.beside`): it holds none of the kind's rows, draws the writes
 * standing over its own, and is waited on, drawn again, and handed the
 * service's word as a read of the pool is.
 *
 * A write whose declaration says it may wait (`WriteDeclaration.queue`) is
 * sent under an idempotency key the pool mints for it once and sends on
 * every attempt. Where the service did not answer it (`Refused.unanswered`),
 * it goes on standing and waits, its caller answered at once with what the
 * declaration says it hears meanwhile; a write that may wait asked while
 * others wait waits behind them, so the service takes them in the order
 * asked. The waiting writes are sent again one at a time, oldest first, as
 * `resend` asks and each time one is laid behind them, until one is still
 * unanswered; one the service took already under its key
 * (`Written.settled`) stands down at once, and one it refused is taken back
 * and counted (`PoolOptions.replayRefused`). At most `QUEUE_BOUND` wait;
 * past them a write unanswered is taken back. They are handed out to be
 * kept (`queued`) and laid back over the rows (`requeue`) in a form of the
 * declaration's own, which names nothing of how they are kept.
 */

import { Deferred, Effect, Equal, Exit, FiberSet, Result, Schema, Scope, Semaphore } from "effect";
import { rowOf, type SyncedCollection, syncedCollection } from "./synced-collection.js";

/** What a change leaves of a row it takes out of every read, as a deleted automation is. */
export const ROW_GONE: unique symbol = Symbol("the row is gone");

/** The most writes that wait for the service at once. */
export const QUEUE_BOUND = 200;

/** A kind of row, as the client that reads it declares it. */
export interface EntityKind<Row extends object, Change> {
  /** The row's key, its entity id. */
  readonly key: (row: Row) => string;
  /**
   * The row as `change` leaves it: a row, `ROW_GONE`, or `undefined` to leave
   * it alone; `row` is none where no read has answered the key.
   */
  readonly drawn: (change: Change, row: Row | undefined) => Row | typeof ROW_GONE | undefined;
}

/** A row made, drawn only while no read has answered its key, as a task started is before its list carries it. */
export interface MadeRow<Row> {
  readonly made: Row;
}

/**
 * A change to a row's fields, from the row as it is drawn now, or its
 * deletion, or a row made: the changes a kind of plain rows is written with.
 */
export type FieldChange<Row> = ((row: Row) => Partial<Row> | typeof ROW_GONE) | MadeRow<Row>;

/** A kind of plain rows, keyed by `key`, whose every change is a `FieldChange`. */
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
      // Note that a change the row already carries leaves it alone, so a reader holds the very row.
      const moved = Object.entries(fields).some(
        ([name, value]) => !Equal.equals(Reflect.get(row, name), value),
      );
      return moved ? { ...row, ...fields } : undefined;
    },
  };
}

/** A read's wait for a write's transaction: it settles once the read carries it, or once the read stops waiting, and never fails. */
export type Confirmation = (txid: string) => Effect.Effect<void>;

/** A read as it stands on a kind. */
export interface PoolRead<Row, Change = unknown> {
  /** Draws the read again as it now stands, as rows it shows move: the keys that moved, which may name some it does not show. */
  readonly redraw: (keys: readonly string[]) => Effect.Effect<void>;
  /** The read's wait for a write's transaction; none while its follow hands none. */
  readonly confirmation: () => Confirmation | undefined;
  /**
   * Whether a row a write makes is the read's to show while the write
   * stands, as every task started is the task list's; a read that names
   * none shows only the rows it answered.
   */
  readonly adopts?: (row: Row) => boolean;
  /**
   * For a read that keeps rows of its own shape outside the pool, as main's
   * account inbox keeps its entries: whether it shows `key`, and how it takes
   * a write's change in its place where it hands no wait. It draws the writes
   * standing (`HeldRows.standing`) over its own rows.
   */
  readonly beside?: {
    readonly shows: (key: string) => boolean;
    readonly take: (change: Change) => void;
  };
}

/** The rows one read holds of a kind, for as long as it stands on it. */
export interface HeldRows<Row extends object, Change = unknown> {
  /**
   * Takes the rows the read answered, in one commit: each upserted, the keys
   * the read holds now theirs, or those `held` names where the read answers
   * only what moved, and any key no read holds any longer gone; answering
   * the keys whose row moved for the read or that it took up or let go.
   * Every other read holding a row that moved is drawn again; the read draws
   * itself. A row answered `at` a sync id never replaces one taken at a
   * newer id, as from a read whose answer was computed before another's.
   */
  readonly answer: (rows: readonly Row[], answered?: Answered) => Effect.Effect<readonly string[]>;
  /** Whether the read shows `key`'s row. */
  readonly holds: (key: string) => boolean;
  /** The rows the read shows, in the order it answered them and then those it adopted, each as the writes standing draw it. */
  readonly rows: () => readonly Row[];
  /** The row `key` names as the read shows it, the very row the read answered where no write changes it; none where it shows none. */
  readonly row: (key: string) => Row | undefined;
  /** The keys of the rows the read shows that a write stands over. */
  readonly pending: () => readonly string[];
  /**
   * The rows the read answered, in the order it answered them, each as the
   * service last answered it with no write drawn over it, as a store that
   * keeps what the service holds reads them.
   */
  readonly synced: () => readonly Row[];
  /** Every change standing over the kind, oldest first, which a read beside the pool draws over its own rows. */
  readonly standing: () => readonly Change[];
}

/** How an answer stands: every key the read holds now, where its rows are only what moved, and the sync id it was read at, where it names one. */
export interface Answered {
  readonly held?: readonly string[];
  readonly at?: bigint;
}

/** What the service answered of a write it took: the caller's answer, and the transaction it committed in. */
export interface Written<Change, Answer> {
  readonly answer: Answer;
  readonly txid: string | undefined;
  /** That the service took the write already, under its key, so it stands down at once and nothing is taken in its place. */
  readonly settled?: true;
  /** What the service says the write left of its rows, taken in the place of a read that hands no wait; the write's own change where it says nothing. */
  readonly taken?: Change;
  /** What the write stands as from the service's answer on, drawn in place of its change until its reads carry it, as an inbox item the service answered is. */
  readonly standsAs?: Change;
  /**
   * The write's own wait for its reads to carry it, for a write whose
   * service cannot answer a transaction, as one made through another
   * system's statement: the write goes on standing until it settles, and
   * only then is what the service answered taken in a read's place. A write
   * that can answer a transaction answers it instead. Nothing waits on it:
   * the caller is answered, and the next write to the keys sent, as the
   * service answers.
   */
  readonly carried?: Effect.Effect<void>;
}

/** A write the service refused, which takes back what it drew, and what the caller answers for it. */
export interface Refused<Answer, Change = never> {
  readonly refused: Answer;
  /** That the service did not answer at all, so a write that may wait goes on standing rather than being taken back. */
  readonly unanswered?: true;
  /** What the service says of the rows instead, taken in every read's place before the write is taken back, so it lands on the service's word. */
  readonly taken?: Change;
}

/** How a write that may wait for the service is kept: its name, its input's kept form, and what its caller hears while it waits. */
export interface QueuedWrite<Input, Answer> {
  /** The write's name, its client's own, which a waiting write is laid back by. */
  readonly name: string;
  /** Its input as it is kept while it waits, and read back. */
  readonly input: Schema.Codec<Input, unknown>;
  /** What its caller hears where it waits rather than being answered. */
  readonly queued: (input: Input) => Answer;
}

/** What one attempt of a write is sent with: the idempotency key of a write that may wait, the same on every attempt; none for any other. */
export interface Sent {
  readonly key: string | undefined;
}

/** A write waiting for the service as the pool hands it out to be kept and takes it back: its declaration's name, its key, and its input in its kept form. */
export interface QueuedEntry {
  readonly name: string;
  readonly key: string;
  readonly input: unknown;
}

/** One kind of write, as its client declares it: what it changes, from its input, and how it is sent. */
export interface WriteDeclaration<Row extends object, Change, Input, Answer> {
  readonly kind: EntityKind<Row, Change>;
  /** The keys of the rows the write changes. */
  readonly keys: (input: Input) => readonly string[];
  /** The change drawn over each of them. */
  readonly change: (input: Input) => Change;
  /** Carries the write to the service under what it is sent with, answering what it answered, or that it refused it. */
  readonly send: (
    input: Input,
    sent: Sent,
  ) => Effect.Effect<Written<Change, Answer> | Refused<Answer, Change>>;
  /** How the write waits where the service does not answer it; none for a write that never waits. */
  readonly queue?: QueuedWrite<Input, Answer>;
}

/** A write declaration whose types are its own, as `requeue` takes each to lay its waiting writes back by. */
export type AnyWrite = <Result>(
  use: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
  ) => Result,
) => Result;

/** `declaration` as `requeue` takes it. */
export function anyWrite<Row extends object, Change, Input, Answer>(
  declaration: WriteDeclaration<Row, Change, Input, Answer>,
): AnyWrite {
  return (use) => use(declaration);
}

/** What a pool that keeps writes waiting is handed. */
export interface PoolOptions {
  /** Mints a write's idempotency key. */
  readonly mintKey: () => string;
  /** Runs once for each waiting write the service refused as it was sent again. */
  readonly replayRefused: Effect.Effect<void>;
}

/** Every row the reads hold, and the writes drawn over them. */
export interface EntityPool {
  /** Stands `read` on `kind`'s rows for the caller's scope, holding none until it answers. */
  readonly stand: <Row extends object, Change>(
    kind: EntityKind<Row, Change>,
    read: PoolRead<Row, Change>,
  ) => Effect.Effect<HeldRows<Row, Change>, never, Scope.Scope>;
  /**
   * `declaration` written with `input`: drawn at once over every read that
   * holds its keys, sent in turn, and answered as soon as the service
   * answers; it goes on standing until those reads carry it, or is taken
   * back, before it answers, where the service refused it.
   */
  readonly write: <Row extends object, Change, Input, Answer>(
    declaration: WriteDeclaration<Row, Change, Input, Answer>,
    input: Input,
  ) => Effect.Effect<Answer>;
  /** The writes waiting for the service, oldest first, as they are kept. */
  readonly queued: () => readonly QueuedEntry[];
  /**
   * Lays `entries` over the rows as writes waiting for the service, behind
   * those waiting already, each by the declaration among `writes` its name
   * names; one no declaration names, or whose input no longer reads, is
   * dropped.
   */
  readonly requeue: (
    entries: readonly QueuedEntry[],
    writes: readonly AnyWrite[],
  ) => Effect.Effect<void>;
  /** Sends the waiting writes again, one at a time, oldest first, until one is still unanswered. */
  readonly resend: Effect.Effect<void>;
  /** Lets go of every waiting write, taking back what each drew, as a sign-out does. */
  readonly letGoQueued: Effect.Effect<void>;
}

/** One read standing on a kind: the keys it holds, in the order it answered them, and the keys of rows a standing write made that it shows meanwhile. */
interface Holding<Row, Change = unknown> {
  readonly read: PoolRead<Row, Change>;
  order: readonly string[];
  held: ReadonlySet<string>;
  adopted: ReadonlySet<string>;
}

/** One write standing: the keys it changes and its change, the service's word in its place once it answered one. */
interface Standing<Change> {
  readonly keys: readonly string[];
  change: Change;
}

/** Where one write stands: answered once the service answered it, and dropped once nothing of it stands drawn. */
interface Turn {
  readonly answered: Deferred.Deferred<void>;
  readonly dropped: Deferred.Deferred<void>;
}

/** How one more attempt of a waiting write ended: kept, refused and taken back, or still unanswered. */
const RETRIED = {
  KEPT: "kept",
  REFUSED: "refused",
  UNANSWERED: "unanswered",
} as const;

type Retried = (typeof RETRIED)[keyof typeof RETRIED];

/** One write waiting for the service: as it is kept, one more attempt of it, and its letting go. */
interface Waiting {
  readonly entry: QueuedEntry;
  readonly retried: Effect.Effect<Retried>;
  readonly letGo: Effect.Effect<void>;
}

/** The writes waiting for the service, oldest first, and what sends them. */
interface Queue {
  readonly options: PoolOptions | undefined;
  readonly confirming: FiberSet.FiberSet<void>;
  readonly lock: Semaphore.Semaphore;
  waiting: readonly Waiting[];
}

/** One kind's rows, the reads standing on them, and the writes drawn over them. */
interface KindRows<Row extends object, Change> {
  readonly kind: EntityKind<Row, Change>;
  readonly synced: SyncedCollection<Row, string>;
  readonly reads: Set<Holding<Row, Change>>;
  /** The writes drawn now, oldest first, each one entry so a change written twice stands twice. */
  standing: readonly Standing<Change>[];
  /** Each key's newest write, which the next write to it is sent after and stands down after. */
  readonly lastWrites: Map<string, Turn>;
  /** The sync id each key's row was taken at, where an answer named one. */
  readonly takenAt: Map<string, bigint>;
}

/** The row `key` names as the reads show it: the synced one with every write standing on it drawn over it, in order; none where none shows. */
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

/** Whether the read shows `key`'s row: one it answered, one it adopted, or one it keeps beside the pool. */
function shows<Row, Change>(holding: Holding<Row, Change>, key: string): boolean {
  return (
    holding.held.has(key) || holding.adopted.has(key) || holding.read.beside?.shows(key) === true
  );
}

/** The keys of the rows the read shows of the pool: those it answered, in order, then those it adopted. */
function shown<Row, Change>(holding: Holding<Row, Change>): readonly string[] {
  return [...holding.order, ...[...holding.adopted].filter((key) => !holding.held.has(key))];
}

/** Whether any read standing holds `key`, as one it answered. */
function heldByAny<Row, Change>(reads: ReadonlySet<Holding<Row, Change>>, key: string): boolean {
  return [...reads].some((holding) => holding.held.has(key));
}

/** The reads standing that show any of `keys`, but `except`. */
function holdersOf<Row, Change>(
  reads: ReadonlySet<Holding<Row, Change>>,
  keys: readonly string[],
  except?: Holding<Row, Change>,
): readonly Holding<Row, Change>[] {
  return [...reads].filter(
    (holding) => holding !== except && keys.some((key) => shows(holding, key)),
  );
}

/** Draws each read again over the keys that moved. */
function redrawn<Row, Change>(
  holdings: readonly Holding<Row, Change>[],
  keys: readonly string[],
): Effect.Effect<void> {
  if (keys.length === 0) return Effect.void;
  return Effect.forEach(holdings, (holding) => holding.read.redraw(keys), { discard: true });
}

/** Whether a write stands over `key`. */
function standingOver<Row extends object, Change>(
  rows: KindRows<Row, Change>,
  key: string,
): boolean {
  return rows.standing.some((write) => write.keys.includes(key));
}

/**
 * Runs `step` over the pool at once, answering the draw again of the reads
 * that showed or show any of `keys` whose row it moved, or that a write
 * began or ceased to stand over. Note that every read showing a key shows
 * the one row, so a key whose drawn row moved moves every read showing it.
 */
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

/** Each read that adopts a row made of `keys`, and does not show it yet, shown it while a write stands over it. */
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

/** Each read let go of the keys of `keys` it adopted that no write stands over any longer. */
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

/** The rows `next` holds taken as the synced ones, answering the keys it wrote, and every read showing one, but `except`, drawn again. */
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

/** Waits for each turn given to reach the point `of` names. */
function awaitEach(
  turns: readonly Turn[],
  of: (turn: Turn) => Deferred.Deferred<void>,
): Effect.Effect<void> {
  return Effect.forEach(turns, (turn) => Deferred.await(of(turn)), { discard: true });
}

/** `read` stood on `rows` for the caller's scope, its keys let go as the scope closes and any row no other read holds with them. */
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

/**
 * `taken` laid over `keys` in the place of each of `holdings`: over the
 * pool's rows they show, and the rows a read keeps beside the pool, every
 * read showing one that moved drawn again. A row a read adopted is held
 * from then as if it had answered it.
 */
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

/**
 * A kept write confirmed on one read showing its keys by the read's own
 * wait, or, where it hands none or the write committed no transaction, what
 * the service answered taken in its place, once the write's own wait for
 * its reads settles where it has one.
 */
function confirmedOn<Row extends object, Change, Answer>(
  rows: KindRows<Row, Change>,
  holding: Holding<Row, Change>,
  write: Standing<Change>,
  written: Written<Change, Answer>,
): Effect.Effect<void> {
  const wait = holding.read.confirmation();
  if (wait !== undefined && written.txid !== undefined) return wait(written.txid);
  const taken = takenInPlace(rows, [holding], write.keys, written.taken ?? write.change);
  return written.carried === undefined ? taken : Effect.andThen(written.carried, taken);
}

/**
 * The waiting writes sent again, one at a time, oldest first, until one is
 * still unanswered; each refused runs `replayRefused`.
 */
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

/**
 * `declaration` written over `rows` with `input`, its confirmation standing
 * on in the queue's fiber set once the service took it; where it may wait,
 * under the key it was kept with (`restored`) or one minted now, and laid
 * at once behind the writes waiting where it was kept or others wait.
 */
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
    // Note that the input is kept as its declaration keeps it as it is asked, so one that will not keep never waits.
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
    // Note that each attempt asks the declaration anew, so one sent again reads the host as it stands then.
    const attempt = Effect.suspend(() => declaration.send(input, { key }));
    const sent = Effect.gen(function* () {
      yield* drawnOn;
      yield* awaitEach(before, (each) => each.answered);
      return yield* attempt;
    }).pipe(Effect.ensuring(Deferred.succeed(turn.answered, undefined)));
    // Note that every read showing the keys is waited on at once, so the write stands until the slowest carries it.
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
            (holding) => confirmedOn(rows, holding, write, kept),
            { concurrency: "unbounded", discard: true },
          );
        }
        yield* awaitEach(before, (each) => each.dropped);
      }).pipe(Effect.ensuring(drop));
    /** A refused write taken back, on the service's word where it gave one. */
    const takenBack = (refused: Refused<Answer, Change>) =>
      Effect.gen(function* () {
        const { taken } = refused;
        if (taken !== undefined) {
          yield* takenInPlace(rows, holdersOf(rows.reads, keys), keys, taken);
        }
        yield* drop;
      });
    /** The write laid behind those waiting, still standing, sent again as they are. */
    const waits = (kept: QueuedEntry) =>
      Effect.sync(() => {
        const waiting: Waiting = {
          entry: kept,
          retried: Effect.gen(function* () {
            const answered = yield* attempt;
            if ("refused" in answered) {
              if (answered.unanswered === true) return RETRIED.UNANSWERED;
              yield* takenBack(answered);
              return RETRIED.REFUSED;
            }
            yield* FiberSet.run(queue.confirming, settled(answered));
            return RETRIED.KEPT;
          }),
          letGo: drop,
        };
        queue.waiting = [...queue.waiting, waiting];
      });
    const room = () => queue.waiting.length < QUEUE_BOUND;
    // Note that a kept write answers before its reads carry it, standing on in a fiber of the pool's; a refused one answers once it is taken back, on the service's word where it gave one; one unanswered that may wait answers at once that it waits.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (plan !== undefined && entry !== undefined && room()) {
          if (restored !== undefined || queue.waiting.length > 0) {
            yield* drawnOn;
            yield* Deferred.succeed(turn.answered, undefined);
            yield* waits(entry);
            if (restored === undefined) yield* FiberSet.run(queue.confirming, resent(queue));
            return plan.queued(input);
          }
        }
        const answered = yield* Effect.onExit(restore(sent), (exit) =>
          Exit.isSuccess(exit) ? Effect.void : drop,
        );
        if ("refused" in answered) {
          if (answered.unanswered === true && plan !== undefined && entry !== undefined && room()) {
            yield* waits(entry);
            return plan.queued(input);
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

/** Each of `entries` laid back over the rows by the declaration its name names among `writes`, in order; one none names, or whose input no longer reads, dropped. */
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

/**
 * The pool, empty, for as long as the caller's scope stands, which every
 * kind's rows and every write still standing or waiting are let go with; a
 * pool handed no options keeps no write waiting, and sends every write
 * without a key.
 */
export function entityPool(options?: PoolOptions): Effect.Effect<EntityPool, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const queue: Queue = {
      options,
      confirming: yield* FiberSet.make<void>(),
      lock: yield* Semaphore.make(1),
      waiting: [],
    };
    /** Each kind's rows, by the kind's own declaration. */
    const kinds = new Map<object, unknown>();
    const rowsOf = <Row extends object, Change>(
      kind: EntityKind<Row, Change>,
    ): Effect.Effect<KindRows<Row, Change>> =>
      Effect.suspend(() => {
        // SAFETY: the map is keyed by the kind itself, so what it holds for `kind` is of `kind`'s row and change.
        const made = () => kinds.get(kind) as KindRows<Row, Change> | undefined;
        const standing = made();
        if (standing !== undefined) return Effect.succeed(standing);
        return Effect.map(Scope.provide(scope)(syncedCollection(kind.key)), (synced) => {
          // Note that a kind made meanwhile by another fiber is the one kept, so a kind has one collection.
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
