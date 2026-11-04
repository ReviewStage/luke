/**
 * live-collection.ts -- the host's TanStack DB collections: each fed, whole and by key, the rows a followed read answers, and changed over them by a write drawn the moment it is asked.
 *
 * A read the host follows answers every row it shows each time any moves
 * (`live-follow.ts`). Its collection takes each answer by key, one sync
 * transaction writing an insert, an update, or a delete for each row that
 * moved and nothing for the rest, so a reader of it hears only what moved
 * (`@repo/sync`'s `syncedCollection`, which never truncates).
 *
 * A write is drawn over a read's rows by the sync engine's pool
 * (`@repo/sync`), never here; a write the service answers with no
 * transaction stands there until the rows its read answered carry it
 * (`carriedWaits`).
 *
 * Every collection here lives for as long as the scope that made it, never
 * by TanStack's own timer (`@repo/sync`'s `KEPT_BY_SCOPE`). How long a
 * read's scope stands is its lifetime class, declared here once rather than
 * by each read: an account read (`accountReads`) stands for the signed-in
 * session, and a read a window holds (`heldReads`) stands while any window
 * holds it and among the few let go latest after. A read a window holds by
 * key is laid on its app-state slice by `heldSlice`, at the path its slice
 * declares (`HOST_READ_SLICE`).
 */

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

/** Every row a collection, or a live query, shows now, what a standing write drew among them. */
export function rowsOf<Row extends object>(collection: {
  readonly toArray: readonly Row[];
}): WithoutVirtualProps<Row>[] {
  return collection.toArray.map((stored) => rowOf<WithoutVirtualProps<Row>>(stored));
}

/** The row a collection shows under `key` now, what a standing write drew among them; none where it shows none. */
export function rowAt<Row extends object, Key extends string>(
  collection: RowCollection<Row, Key>,
  key: Key,
): WithoutVirtualProps<Row> | undefined {
  const stored = collection.get(key);
  return stored === undefined ? undefined : rowOf<WithoutVirtualProps<Row>>(stored);
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
   * each that moved, or none where nothing did, answering the keys it wrote.
   */
  readonly answer: (rows: readonly Row[]) => readonly Key[];
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

/** The waits on a read's own rows, each until they carry what a write changed. */
export interface CarriedWaits<Row> {
  /** Settles every wait the rows the read answered now satisfy; the read calls it after each answer. */
  readonly answered: Effect.Effect<void>;
  /**
   * Waits until the rows the read answered satisfy `until`, at once where
   * they do already: how a write whose service hands no transaction stands
   * until the read carries it (`@repo/sync`'s `Written.carried`). It settles
   * too once the scope closes, so a read that ends holds no write, and gives
   * up after `TX_WAIT_TIMEOUT`, said in the log, since the write committed.
   * Note that it reads the rows the read answered, never what the read
   * shows, since a write's draw stands over them meanwhile.
   */
  readonly carried: (until: (rows: readonly Row[]) => boolean) => Effect.Effect<void>;
}

/** The waits on the rows `answered` reads, each as the read last answered them, for as long as the scope stands. */
export function carriedWaits<Row>(
  answered: () => readonly Row[],
): Effect.Effect<CarriedWaits<Row>, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** Each wait standing, by what it waits for. */
    const waits = new Map<Deferred.Deferred<void>, (rows: readonly Row[]) => boolean>();
    let open = true;
    /** Settles every wait the rows now satisfy, or every one where `all` says the scope closed. */
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

/** A write the service refused, which takes back what it drew, and what the caller answers for it. */
export interface RowRefused<Answer> {
  readonly refused: Answer;
}

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
 * A write to one row of `kind`, declared for the one call and written on
 * `pool`: drawn at once over every read that holds the row, standing until
 * those reads carry it, and taken back where the service refused it. It
 * serves the row writes still served by hand (`gateway-door.ts`), and a
 * write the service already answered, held over its row until the reads
 * carry it.
 */
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

/** One account read, for the account it is opened for, until its fiber is let go. */
type AccountRead = (userId: string) => Effect.Effect<void>;

/**
 * The reads that stand for the signed-in session, as the Inbox's feed does:
 * each opened once for the account signed in, by its name, and every one
 * closed together when the session ends, so no read handles a sign-out or
 * an account switch itself.
 */
export interface AccountReads<Name extends string> {
  /** Opens `name`'s read for the account signed in unless it stands for it already, closing the last account's reads first; nothing while nobody is signed in. */
  readonly open: (name: Name, read: AccountRead) => Effect.Effect<void>;
  /** Opens `name`'s read again at once, as Try again asks, rather than waiting on its own restart. */
  readonly reopen: (name: Name, read: AccountRead) => Effect.Effect<void>;
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
    const run = (name: Name, read: AccountRead, onlyIfMissing: boolean) =>
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

/** How many reads no window holds any longer stay open, the latest let go kept, so a window stepping back to one draws it from where it stands rather than from cold. */
export const RECENT_READS = 8;

/** How a held lifetime keeps the reads no window holds any longer. */
interface LetGo<Key> {
  /** Whether a read let go stops following, what it told standing until it is closed, so one nobody looks at moves nothing; it follows anew once held again. */
  readonly pause: boolean;
  /** Which of the reads let go lately stay, from those let go, the latest last, in that order. */
  readonly kept: (recent: readonly Key[]) => readonly Key[];
}

/**
 * The reads the windows hold, as a plan's or an agent's inbox is: each
 * opened by the first window's hold and kept while any holds it; once the
 * last lets go it stays among those let go lately that `LetGo` keeps, open
 * or paused, until later ones push it out, or the session ends.
 */
interface HeldReads<Key> {
  /** Holds `key`'s read for the caller's scope, opening it unless it stands. */
  readonly hold: (key: Key) => Effect.Effect<void, never, Scope.Scope>;
  /** Whether any window holds `key` now, rather than having let it go lately or never held it. */
  readonly held: (key: Key) => boolean;
  /** Opens `key`'s read again at once, as Try again asks, where a window holds it, or let it go lately and it stands open; nothing otherwise. */
  readonly reopen: (key: Key) => Effect.Effect<void>;
  /** Opens every read a window holds again, as the account signing in asks, so a hold taken while nobody was signed in reads now. */
  readonly reopenHeld: Effect.Effect<void>;
  /** Closes every read let go lately that `which` names; one a window holds stands. */
  readonly drop: (which: (key: Key) => boolean) => Effect.Effect<void>;
  /** Closes every read, those let go lately among them: the session ended. The windows' holds stand, for `reopenHeld`. */
  readonly end: Effect.Effect<void>;
}

/**
 * The held lifetime over `read`, each key's read run as its own fiber until
 * it is closed, or paused where `letGo` says; `closed` runs as one key's
 * read is closed for good, and `ended` once every read is, so what each
 * told is let go.
 */
function heldReads<Key>(
  read: (key: Key) => Effect.Effect<void>,
  closed: (key: Key) => Effect.Effect<void>,
  ended: Effect.Effect<void>,
  /** How the reads let go lately are kept; the latest `RECENT_READS`, open, where none is said. */
  letGo: LetGo<Key> = { pause: false, kept: (recent) => recent.slice(-RECENT_READS) },
): Effect.Effect<HeldReads<Key>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const fibers = yield* FiberMap.make<Key>();
    /** How many windows hold each read. */
    const holders = MutableHashMap.empty<Key, number>();
    /** The reads let go by every window, the latest last. */
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
        // Note that a read let go is closed only once later ones push it out, so a window stepping back a few draws from where it stands.
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

/** A held read whose keys stand in its slice itself, as every read on `heldSlice` does; the feed's stand under its rows. */
export type SliceKeyed = {
  [Slice in HostReadSlice &
    LiveRead]: (typeof HOST_READ_SLICE)[Slice]["on"] extends typeof KEYS_ON.SLICE ? Slice : never;
}[HostReadSlice & LiveRead];

/** What a held read's follow tells of its key as its read moves. */
export interface HeldAnswers<Rows> {
  /** The rows its read answered, which stand as where it is until the next answer. */
  readonly answered: (rows: Rows) => void;
  /** That its read did not answer: failed where it never has, and kept as it stood otherwise, since its next answer brings it up to date. */
  readonly unanswered: () => void;
  /** That its read is asked again, as Try again asks: unread meanwhile where it had failed, so it draws as loading. */
  readonly retried: () => void;
  /** The rows its read holds now, as its last answer left them; none before it first answers. */
  readonly rows: () => Rows | undefined;
}

/** The keys the windows hold of one held read, and what the host does for them. */
export interface HeldSlice<Key> {
  /** Holds `key`'s read for the caller's scope, following it unless it stands. */
  readonly hold: HeldReads<Key>["hold"];
  readonly held: HeldReads<Key>["held"];
  /** Reads `key` again at once, as Try again asks, telling it unread meanwhile where it had failed. */
  readonly retry: (key: Key) => Effect.Effect<void>;
  /** Follows every held key anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Closes every key let go lately that `which` names, dropping what it holds, as an agent archived asks; one a window holds stands. */
  readonly drop: HeldReads<Key>["drop"];
  /** Lets every follow go and tells no key held: the session ended. */
  readonly end: Effect.Effect<void>;
}

/**
 * What the keys let go lately may come to, measured as each is let go: how
 * many, how many bytes of JSON in all, and how many one may come to, one
 * past that closed at once rather than crowd the rest out. A key a window
 * holds counts against none of it, and is never closed.
 */
export interface HeldBudget {
  readonly reads: number;
  readonly bytes: number;
  readonly bytesEach: number;
}

/** A held slice's rows by key, read and laid apart from its follows, as a write's answer lays a key's. */
export interface HeldRows<Key, Rows> {
  /** The rows `key` holds on the slice now; none where its read has not answered, or nobody holds it. */
  readonly rowsOf: (key: Key) => Rows | undefined;
  /**
   * Lays `rows` at `key` as an answer of its read would be, as a write's
   * answer is drawn before its read carries it. Note that a key nobody holds
   * stands laid until one holds it and lets it go, or the session ends.
   */
  readonly lay: (key: Key, rows: Rows) => void;
}

/** `keyed` with `read` laid at `path`, or the key there dropped where it is none, every other key and level the very one held. */
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

/** The read `keyed` holds at `path`; none where it holds none. */
function readAt(keyed: object, path: readonly string[]): AppHostRead<unknown> | undefined {
  let level: unknown = keyed;
  for (const id of path) {
    level =
      typeof level === "object" && level !== null && Object.hasOwn(level, id)
        ? Reflect.get(level, id)
        : undefined;
  }
  // SAFETY: what a held slice holds at a key's whole path is that key's read (`HostReadKeyPath`).
  return level as AppHostRead<unknown> | undefined;
}

const encoder = new TextEncoder();

/**
 * The held lifetime over one read the windows hold by key (`heldReads`),
 * told whole on its slice as each key's read moves: laid at the key's path
 * as its follow last answered it, kept where a later read does not answer,
 * and failed where it never answered; one let go for good is dropped, and
 * every one once the session ends. A key let go stays among the latest
 * `RECENT_READS`, open, or, where the read says so, paused, its rows
 * standing, among those its budget keeps. Behind a closed gate a held key
 * is followed only once the gate opens (`open`). Note that the slice is
 * told as a statement, the moment it moves, so a follow that answers from a
 * callback tells it as one that answers from a fiber does.
 */
export function heldSlice<Slice extends SliceKeyed, Key>(options: {
  /** The slice with no key held, as the host stands before any window holds one and after the session ends. */
  readonly empty: AppState[Slice];
  readonly path: (key: Key) => HostReadKeyPath<Slice>;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** `key`'s read followed until let go, each answer and each failure to answer told through `answers`; one held again after a pause follows on from the rows it left. */
  readonly follow: (key: Key, answers: HeldAnswers<AppHostReads[Slice]>) => Effect.Effect<void>;
  readonly tell: (slice: AppState[Slice]) => void;
  /** Whether a key let go stops following, its rows standing until it is closed, so one nobody looks at moves nothing; none keeps it open. */
  readonly pause?: boolean;
  /** What the keys let go lately may come to; none keeps the latest `RECENT_READS`. */
  readonly budget?: HeldBudget;
}): Effect.Effect<HeldSlice<Key> & HeldRows<Key, AppHostReads[Slice]>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let held = options.empty;
    /** How many bytes of JSON each key let go came to as it was let go. */
    const sizes = MutableHashMap.empty<Key, number>();
    const lay = (key: Key, read: AppHostRead<AppHostReads[Slice]> | undefined) => {
      // SAFETY: a read laid at a key's path keeps the slice's own shape, which that path is declared by.
      held = withKeyLaid(held, options.path(key), read) as AppState[Slice];
      options.tell(held);
    };
    const readOf = (key: Key) => readAt(held, options.path(key));
    const answers = (key: Key): HeldAnswers<AppHostReads[Slice]> => ({
      answered: (rows) => lay(key, { rows }),
      // Note that a read that stops answering keeps its rows, since its next answer brings them up to date.
      unanswered: () => {
        if (readOf(key)?.rows === undefined) lay(key, { failed: true });
      },
      retried: () => {
        if (readOf(key)?.failed === true) lay(key, UNREAD);
      },
      // SAFETY: what a key's path holds is that key's read (`HostReadKeyPath`), whose rows are its slice's.
      rows: () => readOf(key)?.rows as AppHostReads[Slice] | undefined,
    });
    const sizeOf = (key: Key) =>
      Option.getOrElse(MutableHashMap.get(sizes, key), () => {
        const size = encoder.encode(JSON.stringify(readOf(key) ?? null)).byteLength;
        MutableHashMap.set(sizes, key, size);
        return size;
      });
    const budget = options.budget;
    /** The keys let go lately the budget keeps, the latest first in: each past `bytesEach` closed, and every one from the first past the count or the bytes on. */
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
      // Note that a key held again moves once more, so it is measured anew as it is next let go.
      hold: (key) =>
        Effect.andThen(
          Effect.sync(() => MutableHashMap.remove(sizes, key)),
          reads.hold(key),
        ),
      held: reads.held,
      retry: (key) => Effect.andThen(Effect.sync(answers(key).retried), reads.reopen(key)),
      rowsOf: (key) => answers(key).rows(),
      lay: (key, rows) => lay(key, { rows }),
      open: reads.reopenHeld,
      drop: reads.drop,
      end: reads.end,
    };
  });
}
