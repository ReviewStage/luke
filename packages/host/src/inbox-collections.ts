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
 * A write is drawn the moment it is asked, as one optimistic transaction
 * over every standing read it changes, and stands while the service writes
 * it: kept once each of those reads carries its transaction, and taken back
 * where the service refused it. It waits on every read it changed, never
 * the first alone, so the slower view never flickers back, and on none it
 * left alone, since a read whose rows a write did not move is never
 * answered for it. Every txid an inbox write answers reaches every read
 * holding its item: a mark writes the reader's read row, which wakes the
 * account and the item's task and agent, and a nod, an answer, or a close
 * writes the item, which wakes every member's account, its task, and its
 * agent. Where a read hands no wait yet, as before Luke Sync first woke it,
 * the write's own answer is taken in its place. A write the service did
 * not take, the agent having changed the item first, takes the item as the
 * service answered it before it is taken back, so it lands on the
 * service's word.
 *
 * The marks go to the service one at a time, in the order they were asked,
 * each drawn at once over the ones before, so a quick read, unread, read
 * reaches it as the last.
 */

import {
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { inboxInOrder } from "@luke/features/live-wire";
import { Data, Deferred, Effect, Equal, type Scope } from "effect";
import {
  type AnsweredCollection,
  answeredCollection,
  drawRows,
  optimistically,
  rowsOf,
} from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** What a member's write does to the items it names. */
export const INBOX_CHANGE = {
  /** The item settled by the reader: nodded to, answered, or closed. */
  SETTLED: "settled",
  /** Items marked read or unread, as a reply of the reader's marks its item read. */
  MARKED: "marked",
  /** The item as the service answered it. */
  ANSWERED: "answered",
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
  | { readonly kind: typeof INBOX_CHANGE.ANSWERED; readonly item: InboxItem };

/** One standing read as a write reaches it. */
export interface InboxRead {
  /** Draws the change over what the read shows, inside the write's transaction, answering whether it moved anything. */
  readonly draw: (change: InboxChange) => boolean;
  /** Takes the change as the read's own, in its place, where it can confirm no write yet. */
  readonly take: (change: InboxChange) => void;
  /** The read's wait for a write's transaction; none while its follow hands none. */
  readonly txWait: () => TxWait | undefined;
  /** Tells the read's readers what it shows now. */
  readonly drawn: Effect.Effect<void>;
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
  /**
   * `change` drawn over every standing read the moment it is asked, standing
   * while `written` writes it, kept or taken back as `said` reads the answer,
   * which is the caller's either way. A mark (`inTurn`) is written once every
   * mark asked before it settles.
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

/** A write the service refused or did not take, which takes back what it drew. */
class Unwritten extends Data.TaggedError("Unwritten") {}

/** The member signed in, as an answer or a close names who gave it; none where the account names no id. */
export interface InboxReader {
  readonly userId: string;
  readonly name: string;
}

/** The thread's open ask's message, by id; none where its thread holds no open ask, as a notice's. */
function openAskId(item: InboxItem): string | undefined {
  return item.thread?.findLast((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id;
}

/** The thread with the ask on the message given settled as `status` says, and the messages given after it. */
function settledThread(
  thread: readonly InboxMessage[],
  askId: string,
  status: typeof INBOX_ASK_STATUS.ANSWERED | typeof INBOX_ASK_STATUS.WITHDRAWN,
  after: readonly InboxMessage[],
): readonly InboxMessage[] {
  const settled = thread.map((message) =>
    message.id === askId && message.ask !== undefined
      ? { ...message, ask: { ...message.ask, status } }
      : message,
  );
  return [...settled, ...after];
}

/**
 * The item as the reader nodded to it with Got it, before the service says
 * how it stands: answered by the reader, now, and read, as the service
 * answers it, its thread as it was, since a nod writes no message.
 */
export function acknowledgedNow(
  item: InboxItem,
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  return {
    ...item,
    status: INBOX_STATUS.ANSWERED,
    ...(reader === undefined ? undefined : { answeredBy: reader }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}

/**
 * The item as the reader answered it, before the service says how it
 * stands: as a nod leaves it (`acknowledgedNow`), and its open ask answered
 * and the reply carrying the answer after it, under the reply's own key
 * until the service names the message. Note that the files the reply
 * carried are not drawn until then, since the service names them.
 */
export function answeredNow(
  item: InboxItem,
  sent: { readonly key: string; readonly text: string; readonly answers: InboxAnswers },
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const reply: InboxMessage = {
    id: sent.key,
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    ...(reader === undefined ? undefined : { member: reader }),
    text: sent.text,
    answers: sent.answers,
    createdAt: now,
  };
  const thread = settledThread(item.thread ?? [], sent.answers.ask, INBOX_ASK_STATUS.ANSWERED, [
    reply,
  ]);
  return { ...acknowledgedNow(item, reader, now), thread };
}

/** The item as the reader closed it without an answer, before the service says how it stands: closed by the reader, now, and read, its thread's open ask withdrawn with no reason. */
export function closedNow(
  item: InboxItem,
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const askId = openAskId(item);
  const thread =
    item.thread === undefined || askId === undefined
      ? undefined
      : settledThread(item.thread, askId, INBOX_ASK_STATUS.WITHDRAWN, []);
  return {
    ...item,
    status: INBOX_STATUS.CLOSED,
    ...(reader === undefined ? undefined : { closedBy: reader }),
    ...(thread === undefined ? undefined : { thread }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}

/** The item as the change leaves it, from the item as a read holds it; none where it leaves it alone. */
function changedItem(change: InboxChange, item: InboxItem): InboxItem | undefined {
  switch (change.kind) {
    case INBOX_CHANGE.SETTLED:
      return item.id === change.itemId ? change.item(item) : undefined;
    case INBOX_CHANGE.MARKED:
      return change.itemIds.has(item.id) && (item.unread === true) !== change.unread
        ? { ...item, unread: change.unread }
        : undefined;
    case INBOX_CHANGE.ANSWERED:
      return item.id === change.item.id ? change.item : undefined;
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

/** One read's whole items, by id, and how a write reaches them. */
export interface ItemsRead {
  readonly items: AnsweredCollection<InboxItem, string>;
  /** Every item the read shows, a standing write's among them, in the order the held read answers them. */
  readonly shown: () => readonly InboxItem[];
  readonly draw: InboxRead["draw"];
  readonly take: InboxRead["take"];
}

/** A read's whole items in a collection, empty until it first answers, for as long as the scope stands. */
export function itemsRead(): Effect.Effect<ItemsRead, never, Scope.Scope> {
  return Effect.map(answeredCollection({ getKey: (item: InboxItem) => item.id }), (items) => ({
    items,
    shown: () => inboxInOrder(rowsOf(items.collection)),
    draw: (change) => {
      const shown = rowsOf(items.collection);
      let moved = false;
      const next = shown.map((item) => {
        const changed = changedItem(change, item);
        if (changed === undefined || Equal.equals(changed, item)) return item;
        moved = true;
        return changed;
      });
      if (moved) drawRows(items.collection, next);
      return moved;
    },
    take: (change) => {
      for (const id of changedIds(change)) {
        items.confirmRow(id, (item) => {
          const changed = changedItem(change, item);
          return changed === undefined ? {} : whole(item, changed);
        });
      }
    },
  }));
}

/** Whether a change leaves the item no longer open: settled by the reader, or answered settled. */
export function settles(change: InboxChange): boolean {
  if (change.kind === INBOX_CHANGE.SETTLED) return true;
  return change.kind === INBOX_CHANGE.ANSWERED && change.item.status !== INBOX_STATUS.OPEN;
}

/** The every standing inbox read, and the writes over them, for as long as the composer stands. */
export function inboxReads(): InboxReads {
  const standing = new Set<InboxRead>();
  /** The newest mark's settling, which the next mark waits on before it is written. */
  let lastMark: Deferred.Deferred<void> | undefined;
  const drawnAll = (reads: readonly InboxRead[]) =>
    Effect.forEach(reads, (read) => read.drawn, { discard: true });

  /** Confirms a kept write on one read it changed by the read's own wait, or takes the service's word in its place where it hands none. */
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
    return Effect.sync(() => {
      if (taken !== undefined) read.take(taken);
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
          read.drawn,
        ),
      { discard: true },
    );
  };

  return {
    stand: (read) =>
      Effect.acquireRelease(
        Effect.sync(() => standing.add(read)),
        () => Effect.sync(() => standing.delete(read)),
      ),
    write: (change, written, said, inTurn = false) =>
      Effect.gen(function* () {
        const before = inTurn ? lastMark : undefined;
        const settled = yield* Deferred.make<void>();
        if (inTurn) lastMark = settled;
        let changed: readonly InboxRead[] = [];
        const answered: { value?: unknown } = {};
        const draw = () => {
          changed = [...standing].filter((read) => read.draw(change));
        };
        // Note that every read the write changed is waited on at once, each bounded by `TX_WAIT_TIMEOUT`, so the write settles once the slowest has its transaction.
        const work = Effect.gen(function* () {
          yield* drawnAll(changed);
          if (before !== undefined) yield* Deferred.await(before);
          const answer = yield* written;
          answered.value = answer;
          const outcome = said(answer);
          yield* Effect.forEach(changed, (read) => confirmedOn(read, change, outcome), {
            concurrency: "unbounded",
            discard: true,
          });
          yield* behind(changed, outcome);
          if (!outcome.kept) return yield* new Unwritten();
        });
        yield* optimistically(draw, work).pipe(
          Effect.catchTag("Unwritten", () => Effect.void),
          Effect.ensuring(Effect.suspend(() => drawnAll(changed))),
          Effect.ensuring(
            Effect.andThen(
              Deferred.succeed(settled, undefined),
              Effect.sync(() => {
                if (lastMark === settled) lastMark = undefined;
              }),
            ),
          ),
        );
        // SAFETY: the work sets the answer before it settles, whether the service kept the write or not.
        return answered.value as never;
      }),
    confirmAccountWide: (txid) =>
      Effect.forEach(
        [...standing].filter((read) => read.accountWide),
        (read) => confirmWrite(read.txWait(), txid),
        { concurrency: "unbounded", discard: true },
      ),
  };
}
