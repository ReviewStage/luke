import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { INBOX_STATUS, type InboxItem, type InboxReply } from "@luke/features/inbox-wire";
import type { AppInboxTask, AppInboxTasklessItem } from "@luke/host/app-state";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";
import { appStateNow } from "../use-app-state";

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
 * a read holding it settled draws it as it holds it. A message on an
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
 */

/** What the window sent on an item. */
const SETTLING = {
  ANSWER: "answer",
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

type Change =
  | { readonly lay: Omit<Settling, "mainCaughtUp"> }
  | { readonly take: { readonly sent: symbol; readonly item: InboxItem } }
  | { readonly refuse: symbol }
  /** Reads hold these items changed since their entries. */
  | { readonly passed: ReadonlySet<string> }
  /** Main's read was seen without these items. */
  | { readonly mainWithout: ReadonlySet<string> };

const NOTHING_LAID: ReadonlyMap<string, Settling> = new Map();

/**
 * The most sends the window keeps, the oldest the service took let go
 * first, so a long session holds a bounded book. Note that a read asked
 * before a send lands within moments of it, long before this many more.
 */
const KEPT_SENDS = 200;

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

/** What the change makes of the entries. */
function changed(
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

/** What the window sent, kept for the window's life whichever page draws it. */
const settlingAtom: Atom.Writable<ReadonlyMap<string, Settling>, Change> = Atom.keepAlive(
  Atom.writable(
    (): ReadonlyMap<string, Settling> => NOTHING_LAID,
    (ctx, change: Change) => ctx.setSelf(changed(ctx.get(settlingAtom), change)),
  ),
);

/** Whether a read holds the item changed since the entry: posted again, or changed after the service's word on the send. */
function passedBy(read: InboxItem, entry: Settling): boolean {
  return read.revision > entry.revision || (entry.taken && read.updatedAt > entry.item.updatedAt);
}

/** Whether a read holds the message the entry stands for: the newest on the service's thread. */
function holdsMessage(read: InboxItem, entry: Settling): boolean {
  const newest = entry.item.messages?.at(-1)?.id;
  return newest === undefined || (read.messages ?? []).some((message) => message.id === newest);
}

/** How a read's item stands under an entry: the entry's item where the read is behind it, nothing where it holds the send, and passed where it holds a later change. */
function overlaid(read: InboxItem, entry: Settling): InboxItem | "passed" | undefined {
  if (passedBy(read, entry)) return "passed";
  if (entry.kind === SETTLING.ANSWER) {
    return read.status === INBOX_STATUS.OPEN ? entry.item : undefined;
  }
  return holdsMessage(read, entry) ? undefined : entry.item;
}

/** The items as the window holds them, the entries laid over a read behind them, and the items the read has passed; the very list where none is laid. */
function laidItems(
  items: readonly InboxItem[],
  entries: ReadonlyMap<string, Settling>,
  passed: Set<string>,
): readonly InboxItem[] {
  if (entries.size === 0) return items;
  let moved = false;
  const laid = items.map((read) => {
    const entry = entries.get(read.id);
    if (entry === undefined) return read;
    const over = overlaid(read, entry);
    if (over === "passed") passed.add(read.id);
    if (over === undefined || over === "passed") return read;
    moved = true;
    return over;
  });
  return moved ? laid : items;
}

/** Lets go, after a draw, of the entries a read has passed. */
function usePassed(passed: ReadonlySet<string>): void {
  const change = useAtomSet(settlingAtom);
  useEffect(() => {
    if (passed.size > 0) change({ passed });
  }, [change, passed]);
}

/** The entries alone. */
function useEntries(): ReadonlyMap<string, Settling> {
  return useAtomValue(settlingAtom);
}

/** One read's items, the window's own answers and messages laid over them where the read is behind them. */
export function useSettledItems(items: readonly InboxItem[]): readonly InboxItem[] {
  const entries = useEntries();
  const laid = useMemo(() => {
    const passed = new Set<string>();
    const value = laidItems(items, entries, passed);
    return { value, passed: passed.size === 0 ? NO_IDS : passed };
  }, [items, entries]);
  usePassed(laid.passed);
  return laid.value;
}

/** Several reads' items, by task or by agent, each laid over as `useSettledItems` lays one. */
export function useSettledReads(
  reads: ReadonlyMap<string, readonly InboxItem[]>,
): ReadonlyMap<string, readonly InboxItem[]> {
  const entries = useEntries();
  const laid = useMemo(() => {
    const passed = new Set<string>();
    let moved = false;
    const value = new Map(
      [...reads].map(([key, items]) => {
        const over = laidItems(items, entries, passed);
        if (over !== items) moved = true;
        return [key, over] as const;
      }),
    );
    return { value: moved ? value : reads, passed: passed.size === 0 ? NO_IDS : passed };
  }, [reads, entries]);
  usePassed(laid.passed);
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
  const entries = useEntries();
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

/** How a send is laid, and what the service's word makes of it. */
export interface InboxSettler {
  /** Lays an answer on its item at once, as answered by the reader now; the send it stands for. */
  readonly answer: (item: InboxItem, answer: InboxReply) => symbol;
  /** Lays a message's item as the service answered it, over every read that does not hold it yet. */
  readonly message: (item: InboxItem) => void;
  /** The service took the send: the item as it answered, laid over every read behind it. */
  readonly take: (sent: symbol, item: InboxItem) => void;
  /** The service did not take it, so the item stands as the reads hold it. */
  readonly refuse: (sent: symbol) => void;
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
      message: (item) => {
        const sent = Symbol("inbox message");
        change({
          lay: { kind: SETTLING.MESSAGE, item, revision: item.revision, sent, taken: true },
        });
      },
      take: (sent, item) => change({ take: { sent, item } }),
      refuse: (sent) => change({ refuse: sent }),
    }),
    [change],
  );
}
