import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { INBOX_STATUS, type InboxItem, type InboxReply } from "@luke/features/inbox-wire";
import type { AppInboxTask, AppInboxTasklessItem } from "@luke/host/app-state";
import { Atom } from "effect/reactivity";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { appStateNow } from "../use-app-state.js";

/**
 * inbox-settling.ts -- the window's own answers and messages, laid over every read of the Inbox until a read holds the item changed since.
 *
 * The window draws an item from several reads at once: the chosen task's
 * own held read (`use-task-inbox.ts`), every listed task's and every agent
 * with no task's read of the window's Inbox and of Home
 * (`use-inbox-items.ts`, `use-taskless-inbox-items.ts`), and main's read of
 * what waits across the account, which the sidebar counts. Each catches up
 * with an answer in its own time, so an answer the window held in one read
 * alone came back from another, stale, read the moment the window drew from
 * that one instead, and left again once it caught up. So an answer is laid
 * here the moment it is sent, as the item would stand answered, and every
 * read draws it so while it holds the item open at that revision or older;
 * a read holding it settled draws it as it holds it. A close without an
 * answer is laid the same way, as the item would stand closed by the
 * reader. A message on an
 * item's thread, once the service took it, is laid the same way over a read
 * that does not hold it yet.
 *
 * An entry is let go where the service refused it, the item standing again
 * as the reads hold it, or once a read holds the item changed since: at a
 * newer revision, the agent having posted it again, or changed after the
 * service's word on the send. Note that it is not let go once every read
 * merely holds it, because a read asked before the send may still land
 * after, and nothing but a later change says a read is past it; the book
 * keeps the latest sends alone (`KEPT_SENDS`), which bounds it. Main's
 * read names no revision, so it is trusted again once it has been seen
 * without the item: until then it is behind the answer, and after it, an
 * item it lists is one the agent asked again.
 *
 * A read or unread mark is kept in the same book (`use-inbox-read-marks.ts`
 * lays it, `withReadMark` lays it over a read) and laid over every read alike, because a mark wakes the
 * reader's own held read but moves nothing main hears of, so a list's read
 * of the item's plan, read before the mark, is never read again on its
 * account and drew the old dot back the moment the window drew from it
 * again. A mark is let go where the service refused it, once a read holds
 * the item changed since, or once a held read that held the item as marked
 * holds it otherwise, at the same change: a mark made since, another
 * window's, whose word stands.
 */

/** What the window sent on an item. */
const SETTLING = {
  ANSWER: "answer",
  CLOSE: "close",
  MESSAGE: "message",
} as const;

type SettlingKind = (typeof SETTLING)[keyof typeof SETTLING];

/** One send: the item as it stands once sent, the revision sent on, whether the service took it, and whether main's read was seen without the item since. */
interface Settling {
  readonly kind: SettlingKind;
  readonly item: InboxItem;
  readonly revision: number;
  /** The send it stands for, so a later send on the same item is not let go by an earlier one's word. */
  readonly sent: symbol;
  readonly taken: boolean;
  readonly mainCaughtUp: boolean;
}

/**
 * A read mark the window made that the reads may not hold yet: whether the
 * item now reads as unread, and when it last changed as it was marked.
 */
export interface InboxReadMark {
  readonly unread: boolean;
  readonly updatedAt: number;
}

/** Whether an item is unread for the reader; an item from a service before read state reads as read. */
function isUnread(item: InboxItem): boolean {
  return item.unread === true;
}

/**
 * The item with the window's own read mark laid over what a read holds, so
 * a dot flips the moment it is marked rather than when the service's held
 * read next answers; the very item where the mark says nothing new. A mark
 * stands only over the item as it was marked: once the item changes again,
 * a message landing on its thread say, the read's word on it stands, since
 * that change may make it unread again.
 */
export function withReadMark(item: InboxItem, mark: InboxReadMark | undefined): InboxItem {
  if (mark === undefined || mark.updatedAt !== item.updatedAt) return item;
  return isUnread(item) === mark.unread ? item : { ...item, unread: mark.unread };
}

/** One read or unread mark: what it says of the item as it was marked, the press that made it, whether the service took it, and whether a held read has held the item so since. */
interface Mark extends InboxReadMark {
  readonly made: symbol;
  readonly taken: boolean;
  readonly held: boolean;
}

/** What the window holds: its sends and its marks, by item. */
interface Book {
  readonly entries: ReadonlyMap<string, Settling>;
  readonly marks: ReadonlyMap<string, Mark>;
}

/** What a read saw of the marks as it was drawn. */
interface MarksSeen {
  /** The items it holds changed since their marks. */
  readonly passed: ReadonlySet<string>;
  /** The items a held read holds as marked. */
  readonly held: ReadonlySet<string>;
  /** The items a held read held as marked and holds otherwise now. */
  readonly overturned: ReadonlySet<string>;
}

type Change =
  | { readonly lay: Omit<Settling, "mainCaughtUp"> }
  | { readonly take: { readonly sent: symbol; readonly item: InboxItem } }
  | { readonly refuse: symbol }
  /** Reads hold these items changed since their entries. */
  | { readonly passed: ReadonlySet<string> }
  /** Main's read was seen without these items. */
  | { readonly mainWithout: ReadonlySet<string> }
  | {
      readonly mark: {
        readonly made: symbol;
        readonly marks: ReadonlyMap<string, InboxReadMark>;
      };
    }
  | { readonly unmark: symbol }
  | { readonly marked: symbol }
  | { readonly marksSeen: MarksSeen };

const NOTHING_LAID: Book = { entries: new Map(), marks: new Map() };

/**
 * The most sends the window keeps, the oldest the service took let go
 * first, so a long session holds a bounded book. Note that a read asked
 * before a send lands within moments of it, long before this many more.
 */
const KEPT_SENDS = 200;

/** The most read marks the window keeps, the oldest let go first, as `KEPT_SENDS` bounds the sends. */
const KEPT_MARKS = 1_000;

const NO_IDS: ReadonlySet<string> = new Set();

/** The entry for the send given, by item, where it still stands. */
function entryOf(
  entries: ReadonlyMap<string, Settling>,
  sent: symbol,
): readonly [string, Settling] | undefined {
  return [...entries].find(([, entry]) => entry.sent === sent);
}

/** The entries without those named; the very map where it holds none of them. */
function without(
  entries: ReadonlyMap<string, Settling>,
  itemIds: Iterable<string>,
): ReadonlyMap<string, Settling> {
  const gone = [...itemIds].filter((itemId) => entries.has(itemId));
  if (gone.length === 0) return entries;
  const kept = new Map(entries);
  for (const itemId of gone) kept.delete(itemId);
  return kept;
}

/** The entries cut to `KEPT_SENDS`, the oldest the service took let go first; one still on its way is kept. */
function bounded(entries: Map<string, Settling>): ReadonlyMap<string, Settling> {
  let over = entries.size - KEPT_SENDS;
  for (const [itemId, entry] of entries) {
    if (over <= 0) break;
    if (!entry.taken) continue;
    entries.delete(itemId);
    over -= 1;
  }
  return entries;
}

/** What a change to the marks makes of them. */
function marksChanged(marks: ReadonlyMap<string, Mark>, change: Change): ReadonlyMap<string, Mark> {
  if ("mark" in change) {
    const next = new Map(marks);
    for (const [itemId, mark] of change.mark.marks) {
      // Note that an item marked again moves to the newest place, so the oldest marks go first.
      next.delete(itemId);
      next.set(itemId, { ...mark, made: change.mark.made, taken: false, held: false });
    }
    return new Map([...next].slice(-KEPT_MARKS));
  }
  if ("unmark" in change) {
    // Note that a mark is let go only where it still stands as it was made, so a later mark on the same item outlives an earlier one's refusal.
    const ours = [...marks].filter(([, mark]) => mark.made === change.unmark);
    return ours.length === 0
      ? marks
      : new Map([...marks].filter(([, mark]) => mark.made !== change.unmark));
  }
  if ("marked" in change) {
    const ours = [...marks].some(([, mark]) => mark.made === change.marked);
    if (!ours) return marks;
    return new Map(
      [...marks].map(([itemId, mark]) => [
        itemId,
        mark.made === change.marked ? { ...mark, taken: true } : mark,
      ]),
    );
  }
  if (!("marksSeen" in change)) return marks;
  const { passed, held, overturned } = change.marksSeen;
  const gone = (itemId: string) => passed.has(itemId) || overturned.has(itemId);
  const moved = [...marks].some(
    ([itemId, mark]) => gone(itemId) || (held.has(itemId) && !mark.held),
  );
  if (!moved) return marks;
  return new Map(
    [...marks].flatMap(([itemId, mark]): [string, Mark][] => {
      if (gone(itemId)) return [];
      return [[itemId, held.has(itemId) ? { ...mark, held: true } : mark]];
    }),
  );
}

/** What the change makes of the book. */
function changed(book: Book, change: Change): Book {
  const marks = marksChanged(book.marks, change);
  if (marks !== book.marks) return { ...book, marks };
  const entries = entriesChanged(book.entries, change);
  return entries === book.entries ? book : { ...book, entries };
}

/** What the change makes of the entries. */
function entriesChanged(
  entries: ReadonlyMap<string, Settling>,
  change: Change,
): ReadonlyMap<string, Settling> {
  if ("lay" in change) {
    const laid = new Map(entries);
    // Note that a send laid again on the same item moves to the newest place, so the oldest go first.
    laid.delete(change.lay.item.id);
    return bounded(laid.set(change.lay.item.id, { ...change.lay, mainCaughtUp: false }));
  }
  if ("take" in change) {
    const found = entryOf(entries, change.take.sent);
    if (found === undefined) return entries;
    const [itemId, entry] = found;
    return new Map(entries).set(itemId, { ...entry, item: change.take.item, taken: true });
  }
  if ("refuse" in change) {
    const found = entryOf(entries, change.refuse);
    return found === undefined ? entries : without(entries, [found[0]]);
  }
  if ("passed" in change) return without(entries, change.passed);
  if (!("mainWithout" in change)) return entries;
  const caught = [...change.mainWithout].filter(
    (itemId) => entries.get(itemId)?.mainCaughtUp === false,
  );
  if (caught.length === 0) return entries;
  const next = new Map(entries);
  for (const itemId of caught) {
    const entry = entries.get(itemId);
    if (entry !== undefined) next.set(itemId, { ...entry, mainCaughtUp: true });
  }
  return next;
}

/** The account signed in to this window, as its identity names it. */
interface Identity {
  readonly id?: string | undefined;
  readonly email: string;
}

/** The account whose book the window draws: its identity as last heard, and the key its book is kept under, which it keeps for as long as it is the same account. */
interface Owner {
  readonly key: string | null;
  readonly identity: Identity | undefined;
}

const NO_OWNER: Owner = { key: null, identity: undefined };

/**
 * Whether two identities are one account: the same id where both name one,
 * and the same address where either names none, so learning its id or
 * changing its address leaves it the same, while two ids are two accounts
 * whatever their addresses.
 */
function sameAccount(one: Identity | undefined, other: Identity | undefined): boolean {
  if (one === undefined || other === undefined) return false;
  if (one.id !== undefined && other.id !== undefined) return one.id === other.id;
  return one.email === other.email;
}

/** The owner once `identity` is signed in: the same key for the same account, a new one for another. */
function ownedBy(owner: Owner, identity: Identity | undefined): Owner {
  if (identity === undefined) return NO_OWNER;
  if (sameAccount(owner.identity, identity)) return { key: owner.key, identity };
  return { key: identity.id ?? identity.email, identity };
}

const ownerAtom = Atom.keepAlive(Atom.make<Owner>(NO_OWNER));

/** Each account's sends and marks, apart, so what one account sent or marked never stands over another's reads. */
const settlingOf = Atom.family((_key: string | null) => {
  const self: Atom.Writable<Book, Change> = Atom.keepAlive(
    Atom.writable(
      (): Book => NOTHING_LAID,
      (ctx, change: Change) => ctx.setSelf(changed(ctx.get(self), change)),
    ),
  );
  return self;
});

/** What the account signed in to this window sent, kept for the window's life whichever page draws it. */
const settlingAtom = Atom.writable(
  (get) => get(settlingOf(get(ownerAtom).key)),
  (ctx, change: Change) => ctx.set(settlingOf(ctx.get(ownerAtom).key), change),
);

/**
 * Hands the book to the account signed in to this window, before the window
 * is painted, so a send one account made never stands over the next one's
 * reads; a send still on its way when the account changes finds nothing of
 * its own in the next account's book, and moves nothing there. Note that
 * the same account keeps its book as its identity learns its id or its
 * address changes, since its sends are no less its own.
 */
export function useInboxSettlingOwner(account: Identity | undefined): void {
  const owner = useAtomValue(ownerAtom);
  const own = useAtomSet(ownerAtom);
  const id = account?.id;
  const email = account?.email;
  useLayoutEffect(() => {
    const next = ownedBy(owner, email === undefined ? undefined : { id, email });
    const heard = owner.identity?.id === id && owner.identity?.email === email;
    if (next.key !== owner.key || !heard) own(next);
  }, [own, owner, id, email]);
}

/** Whether a read holds the item changed since the entry: posted again, or changed after the service's word on the send. */
function passedBy(read: InboxItem, entry: Settling): boolean {
  return read.revision > entry.revision || (entry.taken && read.updatedAt > entry.item.updatedAt);
}

/** Whether a read holds the message the entry stands for: the newest on the service's thread, its whole thread's from version 5. */
function holdsMessage(read: InboxItem, entry: Settling): boolean {
  const newest = (entry.item.thread ?? entry.item.messages)?.at(-1)?.id;
  const held = [...(read.thread ?? []), ...(read.messages ?? [])];
  return newest === undefined || held.some((message) => message.id === newest);
}

/** How a read's item stands under an entry: the entry's item where the read is behind it, nothing where it holds the send, and passed where it holds a later change. */
function overlaid(read: InboxItem, entry: Settling): InboxItem | "passed" | undefined {
  if (passedBy(read, entry)) return "passed";
  if (entry.kind !== SETTLING.MESSAGE) {
    return read.status === INBOX_STATUS.OPEN ? entry.item : undefined;
  }
  return holdsMessage(read, entry) ? undefined : entry.item;
}

/** What a read saw as it was drawn: the entries it has passed, and what it saw of the marks. */
interface Seen {
  readonly passed: Set<string>;
  readonly marksPassed: Set<string>;
  readonly marksHeld: Set<string>;
  readonly marksOverturned: Set<string>;
}

/** Nothing seen yet. */
function seeing(): Seen {
  return {
    passed: new Set(),
    marksPassed: new Set(),
    marksHeld: new Set(),
    marksOverturned: new Set(),
  };
}

/**
 * A read's item with its mark laid over it, as `withReadMark` lays one;
 * a held read, `live`, says where it holds the item as marked, or, having
 * held it so, otherwise.
 */
function markedItem(
  read: InboxItem,
  item: InboxItem,
  mark: Mark | undefined,
  live: boolean,
  seen: Seen,
): InboxItem {
  if (mark === undefined) return item;
  if (read.updatedAt > mark.updatedAt) {
    seen.marksPassed.add(read.id);
    return item;
  }
  if (live && read.updatedAt === mark.updatedAt) {
    const agrees = isUnread(read) === mark.unread;
    // Note that a read is taken to hold the mark only once the service took it, since one from before the write, or from an earlier mark's write, may agree by chance.
    if (agrees && mark.taken && !mark.held) seen.marksHeld.add(read.id);
    if (!agrees && mark.held) {
      seen.marksOverturned.add(read.id);
      return item;
    }
  }
  return withReadMark(item, mark);
}

/** The items as the window holds them, the entries and marks laid over a read behind them; the very list where none is laid. */
function laidItems(
  items: readonly InboxItem[],
  book: Book,
  live: boolean,
  seen: Seen,
): readonly InboxItem[] {
  if (book.entries.size === 0 && book.marks.size === 0) return items;
  const laid = items.map((read) => {
    const entry = book.entries.get(read.id);
    const over = entry === undefined ? undefined : overlaid(read, entry);
    if (over === "passed") seen.passed.add(read.id);
    const item = over === undefined || over === "passed" ? read : over;
    return markedItem(read, item, book.marks.get(read.id), live, seen);
  });
  return laid.every((item, at) => item === items[at]) ? items : laid;
}

/** Says, after a draw, what a read saw: the entries and marks it has passed, and the marks a held read holds. */
function useSeen(seen: Seen): void {
  const change = useAtomSet(settlingAtom);
  useEffect(() => {
    const { passed, marksPassed, marksHeld, marksOverturned } = seen;
    if (passed.size > 0) change({ passed });
    if (marksPassed.size + marksHeld.size + marksOverturned.size > 0) {
      change({
        marksSeen: { passed: marksPassed, held: marksHeld, overturned: marksOverturned },
      });
    }
  }, [change, seen]);
}

/** The book alone. */
function useBook(): Book {
  return useAtomValue(settlingAtom);
}

/** A task's own held read's items, the window's own answers, messages, and marks laid over them where the read is behind them. */
export function useSettledItems(items: readonly InboxItem[]): readonly InboxItem[] {
  const book = useBook();
  const laid = useMemo(() => {
    const seen = seeing();
    return { value: laidItems(items, book, true, seen), seen };
  }, [items, book]);
  useSeen(laid.seen);
  return laid.value;
}

/** Several list reads' items, by task or by agent, each laid over as `useSettledItems` lays one; a list's read is read once, and says nothing of a mark made since. */
export function useSettledReads(
  reads: ReadonlyMap<string, readonly InboxItem[]>,
): ReadonlyMap<string, readonly InboxItem[]> {
  const book = useBook();
  const laid = useMemo(() => {
    const seen = seeing();
    let moved = false;
    const value = new Map(
      [...reads].map(([key, items]) => {
        const over = laidItems(items, book, false, seen);
        if (over !== items) moved = true;
        return [key, over] as const;
      }),
    );
    return { value: moved ? value : reads, seen };
  }, [reads, book]);
  useSeen(laid.seen);
  return laid.value;
}

/** What main's read says waits across the account, the items the window answered left out until main hears of it. */
export interface SettledWaiting {
  readonly waiting: readonly AppInboxTask[];
  readonly taskless: readonly AppInboxTasklessItem[];
}

/**
 * Main's read of what waits, the items the window answered left out until
 * main is first seen without them, so a count drops the moment an answer is
 * sent and an item the agent asks again afterwards counts again.
 */
export function useSettledWaiting(
  waiting: readonly AppInboxTask[],
  taskless: readonly AppInboxTasklessItem[],
): SettledWaiting {
  const { entries } = useBook();
  const change = useAtomSet(settlingAtom);
  const laid = useMemo(() => {
    const listed = new Set(
      [...waiting.flatMap((task) => task.items), ...taskless].map(({ id }) => id),
    );
    // Note that an entry standing for a settled item hides it, a message laid since an answer among them.
    const hidden = (itemId: string) => {
      const entry = entries.get(itemId);
      return entry !== undefined && !entry.mainCaughtUp && entry.item.status !== INBOX_STATUS.OPEN;
    };
    const seenWithout = [...entries.keys()].filter((itemId) => !listed.has(itemId));
    const mainWithout = seenWithout.length === 0 ? NO_IDS : new Set(seenWithout);
    if (![...listed].some(hidden)) return { value: { waiting, taskless }, mainWithout };
    const value = {
      waiting: waiting
        .map((task) => ({ ...task, items: task.items.filter((item) => !hidden(item.id)) }))
        .filter((task) => task.items.length > 0),
      taskless: taskless.filter((item) => !hidden(item.id)),
    };
    return { value, mainWithout };
  }, [waiting, taskless, entries]);
  const { mainWithout } = laid;
  useEffect(() => {
    if (mainWithout.size > 0) change({ mainWithout });
  }, [change, mainWithout]);
  return laid.value;
}

/** The signed-in member, as an answer names who gave it; none where the account names no id. */
function readerNow(): { readonly userId: string; readonly name: string } | undefined {
  const account = appStateNow()?.account;
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN || account.id === undefined) return undefined;
  return { userId: account.id, name: account.name ?? account.email };
}

/**
 * The item as the window answered it, before the service says how it
 * stands: answered by the reader, now, and read, as the service answers it.
 * Note that the files the answer carried are not drawn until then, since
 * the service names them.
 */
function answeredNow(item: InboxItem, answer: InboxReply, now: number): InboxItem {
  const reader = readerNow();
  return {
    ...item,
    status: INBOX_STATUS.ANSWERED,
    answer,
    ...(reader === undefined ? undefined : { answeredBy: reader }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}

/** The item as the window closed it without an answer, before the service says how it stands: closed by the reader, now, and read. */
function closedNow(item: InboxItem, now: number): InboxItem {
  const reader = readerNow();
  return {
    ...item,
    status: INBOX_STATUS.CLOSED,
    ...(reader === undefined ? undefined : { closedBy: reader }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}

/** How a send is laid, and what the service's word makes of it. */
export interface InboxSettler {
  /** Lays an answer on its item at once, as answered by the reader now; the send it stands for. */
  readonly answer: (item: InboxItem, answer: InboxReply) => symbol;
  /** Lays a close without an answer on its item at once, as closed by the reader now; the send it stands for. */
  readonly close: (item: InboxItem) => symbol;
  /** Lays a message's item as the service answered it, over every read that does not hold it yet. */
  readonly message: (item: InboxItem) => void;
  /** The service took the send: the item as it answered, laid over every read behind it. */
  readonly take: (sent: symbol, item: InboxItem) => void;
  /** The service did not take it, so the item stands as the reads hold it. */
  readonly refuse: (sent: symbol) => void;
  /** Lays read or unread marks, by item, over every read at once; the press they stand for. */
  readonly mark: (marks: ReadonlyMap<string, InboxReadMark>) => symbol;
  /** The service did not take the press's marks, so the dots stand as the reads hold them. */
  readonly unmark: (made: symbol) => void;
  /** The service took the press's marks, so a held read holding them from now on holds them. */
  readonly marked: (made: symbol) => void;
}

/** The presses that lay a send over the reads, the same for the window's life. */
export function useInboxSettler(): InboxSettler {
  const change = useAtomSet(settlingAtom);
  return useMemo(
    () => ({
      answer: (item, answer) => {
        const sent = Symbol("inbox answer");
        const laid = answeredNow(item, answer, Date.now());
        change({
          lay: { kind: SETTLING.ANSWER, item: laid, revision: item.revision, sent, taken: false },
        });
        return sent;
      },
      close: (item) => {
        const sent = Symbol("inbox close");
        const laid = closedNow(item, Date.now());
        change({
          lay: { kind: SETTLING.CLOSE, item: laid, revision: item.revision, sent, taken: false },
        });
        return sent;
      },
      message: (item) => {
        const sent = Symbol("inbox message");
        change({
          lay: { kind: SETTLING.MESSAGE, item, revision: item.revision, sent, taken: true },
        });
      },
      take: (sent, item) => change({ take: { sent, item } }),
      refuse: (sent) => change({ refuse: sent }),
      mark: (marks) => {
        const made = Symbol("inbox read mark");
        change({ mark: { made, marks } });
        return made;
      },
      unmark: (made) => change({ unmark: made }),
      marked: (made) => change({ marked: made }),
    }),
    [change],
  );
}
