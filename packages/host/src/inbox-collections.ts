/**
 * inbox-collections.ts -- every inbox read the host follows, held in TanStack DB collections, one set a read, and a member's write on an item drawn over each that holds it the moment it is asked.
 *
 * Each followed read keeps what it answers in collections of its own
 * (`live-collection.ts`): a plan's or an agent's inbox and the account's
 * feed of every item (`itemsRead`) whole items by id, and main's read of
 * what waits (`account-inbox-follow.ts`) its brief entries and the tasks
 * holding them. Each stands among the reads a write reaches for as long as
 * its follow does (`InboxReads.stand`), so an item several reads hold, as
 * the open task's inbox and the feed both do, is one write over all of them.
 *
 * An items read reads each item from its collection by id, the very object
 * the collection holds until the item moves, and a change draws again only
 * the items it names: an answer the keys its collection wrote, and a write
 * the items it changes. So a reader of what did not move holds the same
 * object, and a change costs what it moved rather than the read's whole.
 *
 * A write is drawn the moment it is asked, laid over the rows every read
 * holds, and stands until each read it changed carries its transaction, or
 * is taken back where the service refused it. Note that it is the host's
 * own overlay rather than a TanStack transaction, because a persisting
 * transaction holds back every answer its collection is synced, so a mark
 * would freeze what arrives meanwhile; here a read takes each answer at
 * once and draws the writes standing over it, in the order asked. So a
 * change is drawn again over each row a read takes while it stands, and
 * must leave a row the service already changed as it is. It waits on every
 * read it changed, never the first alone, so the slower view never
 * flickers back, and on none it left alone, since a read whose rows a
 * write did not move is never answered for it. Every txid an inbox write
 * answers reaches every read holding its item: a mark writes the reader's
 * read row, which wakes the account and the item's task and agent, and a
 * nod, an answer, or a close writes the item, which wakes every member's
 * account, its task, and its agent. Where a read hands no wait yet, as
 * before Luke Sync first woke it, the write's own answer is taken in its
 * place. A write the service did not take, the agent having changed the
 * item first, takes the item as the service answered it before it is taken
 * back, so it lands on the service's word.
 *
 * A write answers its caller once the service has, so a send reads as sent
 * the moment it is taken, and goes on standing until its reads carry it.
 * The writes to one item stand down in the order they were asked, so an
 * older one never stands over a newer one the reads already carry; and a
 * mark goes to the service once every write to its items asked before it
 * has been answered, so a quick read, unread, read reaches it as the last,
 * while marks on other items go at once.
 */

import { INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { inboxInOrder } from "@luke/features/live-wire";
import { Deferred, Effect, Equal, Exit, FiberSet, type Scope } from "effect";
import { type AnsweredCollection, answeredCollection, rowAt, rowsOf } from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** What a member's write does to the items it names. */
export const INBOX_CHANGE = {
  /** The item settled by the reader: nodded to, answered, or closed. */
  SETTLED: "settled",
  /** Items marked read or unread, as a reply of the reader's marks its item read. */
  MARKED: "marked",
  /** The item as the service answered it. */
  ANSWERED: "answered",
  /** The thread moved into another channel of its workspace. */
  MOVED: "moved",
} as const;

/** One write's change, as every read draws it over what it holds. */
export type InboxChange =
  | {
      readonly kind: typeof INBOX_CHANGE.SETTLED;
      readonly itemId: string;
      /** What the item becomes, from the item as the read holds it. */
      readonly item: (item: InboxItem) => InboxItem;
    }
  | {
      readonly kind: typeof INBOX_CHANGE.MARKED;
      readonly itemIds: ReadonlySet<string>;
      readonly unread: boolean;
    }
  | { readonly kind: typeof INBOX_CHANGE.ANSWERED; readonly item: InboxItem }
  | {
      readonly kind: typeof INBOX_CHANGE.MOVED;
      readonly itemId: string;
      readonly channelId: string;
    };

/** One standing read as a write reaches it. */
export interface InboxRead {
  /** What the read shows of the items `ids` names now, the writes standing drawn over them, compared whole to tell which reads a write moves. */
  readonly shown: (ids: readonly string[]) => unknown;
  /** Takes the change as the read's own, in its place, where it can confirm no write yet. */
  readonly take: (change: InboxChange) => void;
  /** The read's wait for a write's transaction; none while its follow hands none. */
  readonly txWait: () => TxWait | undefined;
  /** Tells the read's readers what it shows now, the items `ids` names drawn again. */
  readonly drawn: (ids: readonly string[]) => Effect.Effect<void>;
  /** Whether the read is the account's own, which every write on an item the account reaches wakes. */
  readonly accountWide: boolean;
}

/** What the service answered of a write: its transaction, the item as it then stands where it names one, and whether it was kept. */
export interface InboxWritten {
  readonly txid: string | undefined;
  readonly item: InboxItem | undefined;
  readonly kept: boolean;
}

/** Every standing read of the inbox, and the writes drawn over them. */
export interface InboxReads {
  /** Stands `read` among those a write reaches, for as long as the caller's scope. */
  readonly stand: (read: InboxRead) => Effect.Effect<void, never, Scope.Scope>;
  /** The writes standing, oldest first, which every read draws over the rows it holds, in turn. */
  readonly standingWrites: () => readonly InboxChange[];
  /**
   * `change` drawn over every standing read the moment it is asked, standing
   * while `written` writes it and until each read it changed carries it, or
   * taken back as `said` reads the answer, which is the caller's either way
   * and answered as soon as the service gives it. A mark (`inTurn`) is
   * written once every write to its items asked before it is answered.
   */
  readonly write: <A>(
    change: InboxChange,
    written: Effect.Effect<A>,
    said: (answer: A) => InboxWritten,
    inTurn?: boolean,
  ) => Effect.Effect<A>;
  /** Waits for a write that draws nothing, as a thread started is, on the account's own reads. */
  readonly confirmAccountWide: (txid: string | undefined) => Effect.Effect<void>;
}

/** Where one write stands: answered once the service answered it, and dropped once nothing of it stands drawn. */
interface Turn {
  readonly answered: Deferred.Deferred<void>;
  readonly dropped: Deferred.Deferred<void>;
}

/**
 * The item as the change leaves it, from the item as a read holds it; none
 * where it leaves it alone. Note that a settle leaves an item no longer
 * open alone, and the service's item one changed since, because a change
 * is drawn again over each answer while it stands, and the service's own
 * newer item is what it draws.
 */
function changedItem(change: InboxChange, item: InboxItem): InboxItem | undefined {
  switch (change.kind) {
    case INBOX_CHANGE.SETTLED:
      return item.id === change.itemId && item.status === INBOX_STATUS.OPEN
        ? change.item(item)
        : undefined;
    case INBOX_CHANGE.MARKED:
      return change.itemIds.has(item.id) && (item.unread === true) !== change.unread
        ? { ...item, unread: change.unread }
        : undefined;
    case INBOX_CHANGE.ANSWERED:
      return item.id === change.item.id && item.updatedAt <= change.item.updatedAt
        ? change.item
        : undefined;
    case INBOX_CHANGE.MOVED:
      return item.id === change.itemId && item.channelId !== change.channelId
        ? { ...item, channelId: change.channelId }
        : undefined;
  }
}

/** The ids of the items a change names. */
export function changedIds(change: InboxChange): readonly string[] {
  switch (change.kind) {
    case INBOX_CHANGE.SETTLED:
      return [change.itemId];
    case INBOX_CHANGE.MARKED:
      return [...change.itemIds];
    case INBOX_CHANGE.ANSWERED:
      return [change.item.id];
    case INBOX_CHANGE.MOVED:
      return [change.itemId];
  }
}

/**
 * `next` as the fields that replace `row` whole: every key `next` drops left
 * undefined, which a collection reads as absent, since a row is taken by
 * laying fields over it.
 */
function whole<Row extends object>(row: Row, next: Row): Partial<Row> {
  const dropped = Object.keys(row).filter((name) => !(name in next));
  return { ...Object.fromEntries(dropped.map((name) => [name, undefined])), ...next };
}

/** The item as every write standing leaves it, in the order they were asked; the very item where none changes it. */
function drawnOver(writes: readonly InboxChange[], item: InboxItem): InboxItem {
  return writes.reduce((each, change) => changedItem(change, each) ?? each, item);
}

/** One read's whole items, by id, and how a write reaches them. */
export interface ItemsRead {
  readonly items: AnsweredCollection<InboxItem, string>;
  /** The item `id` names as the read shows it, the writes standing drawn over it, the very object the collection holds where none changes it; none where the read holds none. */
  readonly drawnOf: (id: string) => InboxItem | undefined;
  /** Every item the read shows, the writes standing drawn over them, in the order the held read answers them. */
  readonly inOrder: () => readonly InboxItem[];
  readonly shown: InboxRead["shown"];
  readonly take: InboxRead["take"];
}

/** A read's whole items in a collection, empty until it first answers, the writes `reads` holds standing drawn over them, for as long as the scope stands. */
export function itemsRead(
  reads: Pick<InboxReads, "standingWrites">,
): Effect.Effect<ItemsRead, never, Scope.Scope> {
  return Effect.map(answeredCollection({ getKey: (item: InboxItem) => item.id }), (items) => {
    const drawnOf = (id: string) => {
      const item = rowAt(items.collection, id);
      return item === undefined ? undefined : drawnOver(reads.standingWrites(), item);
    };
    return {
      items,
      drawnOf,
      inOrder: () => {
        const writes = reads.standingWrites();
        return inboxInOrder(rowsOf(items.collection).map((item) => drawnOver(writes, item)));
      },
      shown: (ids) => ids.map(drawnOf),
      take: (change) => {
        for (const id of changedIds(change)) {
          items.confirmRow(id, (item) => {
            const changed = changedItem(change, item);
            return changed === undefined ? {} : whole(item, changed);
          });
        }
      },
    };
  });
}

/** Whether a change leaves the item no longer open: settled by the reader, or answered settled. */
export function settles(change: InboxChange): boolean {
  if (change.kind === INBOX_CHANGE.SETTLED) return true;
  return change.kind === INBOX_CHANGE.ANSWERED && change.item.status !== INBOX_STATUS.OPEN;
}

/** Waits for each turn given to reach the point `of` names. */
function awaitEach(turns: readonly Turn[], of: (turn: Turn) => Deferred.Deferred<void>) {
  return Effect.forEach(turns, (turn) => Deferred.await(of(turn)), { discard: true });
}

/**
 * Every standing inbox read, and the writes over them, for as long as the
 * composer's scope stands, which a write still waiting on its reads is let
 * go with.
 */
export function inboxReads(): Effect.Effect<InboxReads, never, Scope.Scope> {
  return Effect.map(FiberSet.make(), (confirming) => {
    const standing = new Set<InboxRead>();
    /** The writes drawn now, oldest first, each one entry so a change written twice stands twice. */
    let drawnWrites: readonly { change: InboxChange }[] = [];
    /** Each item's newest write, which the next write to it stands down after, and the next mark is written after. */
    const lastWrites = new Map<string, Turn>();
    const drawnAll = (reads: readonly InboxRead[], ids: readonly string[]) =>
      Effect.forEach(reads, (read) => read.drawn(ids), { discard: true });
    /**
     * Runs `step` over the writes drawn, answering each standing read it
     * changed what it shows of the items `ids` names, which are all a step
     * on one write can move. Note that each read compares what it shows of
     * them, never the change, because a write dropped or answered stands
     * among others, which may draw over it.
     */
    const movedBy = (ids: readonly string[], step: () => void): readonly InboxRead[] => {
      const reads = [...standing];
      const before = reads.map((read) => read.shown(ids));
      step();
      return reads.filter((read, at) => !Equal.equals(before[at], read.shown(ids)));
    };

    /** Confirms a kept write on one read it changed by the read's own wait, or takes the service's word in its place where it hands none, and draws it. */
    const confirmedOn = (read: InboxRead, change: InboxChange, written: InboxWritten) => {
      const wait = read.txWait();
      if (written.kept && written.txid !== undefined && wait !== undefined) {
        return confirmWrite(wait, written.txid);
      }
      const taken: InboxChange | undefined =
        written.item !== undefined
          ? { kind: INBOX_CHANGE.ANSWERED, item: written.item }
          : written.kept
            ? change
            : undefined;
      return Effect.suspend(() => {
        if (taken === undefined) return Effect.void;
        read.take(taken);
        return read.drawn(changedIds(taken));
      });
    };

    /**
     * The service's word on an item, where its write committed no transaction
     * a read could carry, taken by every read the write did not change, so a
     * read that would draw it as it stood before, a reply's thread without
     * the reply, draws it as the service answered.
     */
    const behind = (changed: readonly InboxRead[], written: InboxWritten) => {
      const { item } = written;
      if (written.txid !== undefined || item === undefined) return Effect.void;
      const others = [...standing].filter((read) => !changed.includes(read));
      return Effect.forEach(
        others,
        (read) =>
          Effect.andThen(
            Effect.sync(() => read.take({ kind: INBOX_CHANGE.ANSWERED, item })),
            read.drawn([item.id]),
          ),
        { discard: true },
      );
    };

    /**
     * `change` laid over every read as the newest write to its items: their
     * ids, the writes to them asked before it, and the reads it moved, for
     * the caller to draw. `answeredWith` draws the service's own item in its
     * place, answering the reads that moves, each drawn again; `drop` takes
     * it out, drawing each read that shows otherwise without it, and is run
     * once.
     */
    const laid = (change: InboxChange, turn: Turn) => {
      const ids = changedIds(change);
      const before = [...new Set(ids.flatMap((id) => lastWrites.get(id) ?? []))];
      for (const id of ids) lastWrites.set(id, turn);
      const entry = { change };
      const changed = movedBy(ids, () => {
        drawnWrites = [...drawnWrites, entry];
      });
      const answeredWith = (item: InboxItem) =>
        Effect.suspend(() => {
          const named = [...new Set([...changedIds(entry.change), item.id])];
          const moved = movedBy(named, () => {
            entry.change = { kind: INBOX_CHANGE.ANSWERED, item };
          });
          return Effect.as(drawnAll(moved, named), moved);
        });
      const drop = Effect.suspend(() => {
        for (const id of ids) if (lastWrites.get(id) === turn) lastWrites.delete(id);
        const named = changedIds(entry.change);
        return drawnAll(
          movedBy(named, () => {
            drawnWrites = drawnWrites.filter((each) => each !== entry);
          }),
          named,
        );
      }).pipe(Effect.ensuring(Deferred.succeed(turn.dropped, undefined)));
      return { ids, before, changed, answeredWith, drop };
    };

    return {
      stand: (read) =>
        Effect.acquireRelease(
          Effect.sync(() => standing.add(read)),
          () => Effect.sync(() => standing.delete(read)),
        ),
      standingWrites: () => drawnWrites.map((each) => each.change),
      write: (change, written, said, inTurn = false) =>
        Effect.gen(function* () {
          const turn: Turn = {
            answered: yield* Deferred.make<void>(),
            dropped: yield* Deferred.make<void>(),
          };
          const { ids, before, changed, answeredWith, drop } = laid(change, turn);
          const asked = Effect.gen(function* () {
            yield* drawnAll(changed, ids);
            if (inTurn) yield* awaitEach(before, (each) => each.answered);
            return yield* written;
          }).pipe(Effect.ensuring(Deferred.succeed(turn.answered, undefined)));
          // Note that every read the write changed is waited on at once, each bounded by `TX_WAIT_TIMEOUT`, so the write stands until the slowest has its transaction.
          const settled = (outcome: InboxWritten, waited: readonly InboxRead[]) =>
            Effect.gen(function* () {
              yield* Effect.forEach(waited, (read) => confirmedOn(read, change, outcome), {
                concurrency: "unbounded",
                discard: true,
              });
              yield* behind(waited, outcome);
              if (outcome.kept) yield* awaitEach(before, (each) => each.dropped);
            }).pipe(Effect.ensuring(drop));
          // Note that a kept write answers before its reads carry it, standing on in a fiber of the composer's as the item the service answered, so a reply stays on its thread; a refused one answers once it is taken back.
          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const answer = yield* Effect.onExit(restore(asked), (exit) =>
                Exit.isSuccess(exit) ? Effect.void : drop,
              );
              const outcome = said(answer);
              if (!outcome.kept) {
                yield* settled(outcome, changed);
                return answer;
              }
              const moved = outcome.item === undefined ? [] : yield* answeredWith(outcome.item);
              yield* FiberSet.run(
                confirming,
                settled(outcome, [...new Set([...changed, ...moved])]),
              );
              return answer;
            }),
          );
        }),
      confirmAccountWide: (txid) =>
        Effect.forEach(
          [...standing].filter((read) => read.accountWide),
          (read) => confirmWrite(read.txWait(), txid),
          { concurrency: "unbounded", discard: true },
        ),
    };
  });
}
