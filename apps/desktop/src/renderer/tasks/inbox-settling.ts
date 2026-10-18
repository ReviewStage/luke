import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { INBOX_STATUS, type InboxItem, type InboxReply } from "@luke/features/inbox-wire";
import type { AppInboxTask, AppInboxTasklessItem } from "@luke/host/app-state";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo, useRef } from "react";
import { appStateNow } from "../use-app-state";

/**
 * inbox-settling.ts -- the window's own answers and messages on their way, laid over every read of the Inbox until each read holds them.
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
 * read draws it so until it holds the item settled, or at a newer revision,
 * since the agent posted it again; a stale read never brings it back. A
 * message on an item's thread, once the service took it, is laid the same
 * way, until a read holds the item as it changed then or later.
 *
 * As `use-inbox-read-marks.ts` keeps a mark until the reads catch up, each
 * read here says which items it is still behind on (`report`), and an entry
 * the service took is let go once no read is behind on it, or at once where
 * the service refused it, the item standing again as it was. A read that
 * holds the item at a newer revision lets go of it too, since what was
 * answered is no longer what the agent asks.
 */

/** What the window sent on an item. */
const SETTLING = {
  ANSWER: "answer",
  MESSAGE: "message",
} as const;

type SettlingKind = (typeof SETTLING)[keyof typeof SETTLING];

/** One send the reads may not hold yet: the item as it stands once sent, the revision sent on, whether the service took it, and the book's version it was last moved in. */
interface Settling {
  readonly kind: SettlingKind;
  readonly item: InboxItem;
  readonly revision: number;
  /** The send it stands for, so a later send on the same item is not let go by an earlier one's word. */
  readonly sent: symbol;
  readonly taken: boolean;
  readonly at: number;
}

/** Every entry by item, and a version moved with each change, which a read's word names as the one it drew. */
interface Book {
  readonly entries: ReadonlyMap<string, Settling>;
  readonly version: number;
}

/** One read that draws items. */
type Source = symbol;

/** A read's word: which entries it is behind on, as of the book's version it drew. */
interface Word {
  readonly behind: ReadonlySet<string>;
  readonly version: number;
}

interface Held {
  readonly book: Book;
  readonly words: ReadonlyMap<Source, Word>;
}

type Change =
  | { readonly lay: Omit<Settling, "at"> }
  | { readonly take: { readonly sent: symbol; readonly item: InboxItem } }
  | { readonly refuse: symbol }
  | {
      readonly report: {
        readonly source: Source;
        readonly word: Word;
        readonly passed: ReadonlySet<string>;
      };
    }
  | { readonly leave: Source };

const NOTHING_HELD: Held = { book: { entries: new Map(), version: 0 }, words: new Map() };

const NO_IDS: ReadonlySet<string> = new Set();

/** Whether two sets hold the same ids. */
function sameIds(one: ReadonlySet<string>, other: ReadonlySet<string>): boolean {
  return one.size === other.size && [...other].every((id) => one.has(id));
}

/** The book with its entries moved on to `entries`, its version with them. */
function moved(held: Held, entries: ReadonlyMap<string, Settling>): Held {
  return { ...held, book: { entries, version: held.book.version + 1 } };
}

/**
 * The entries with every one let go that the service took and that every
 * read has drawn since and is not behind on; the very book where none is.
 * Note that a read that has not drawn an entry yet keeps it, because what
 * it last said was said of a book without it.
 */
function caughtUp(held: Held): Held {
  const words = [...held.words.values()];
  const kept = [...held.book.entries].filter(
    ([itemId, entry]) =>
      !entry.taken || words.some((word) => word.version < entry.at || word.behind.has(itemId)),
  );
  return kept.length === held.book.entries.size ? held : moved(held, new Map(kept));
}

/** The entry for the send given, by item, where it still stands. */
function entryOf(held: Held, sent: symbol): readonly [string, Settling] | undefined {
  return [...held.book.entries].find(([, entry]) => entry.sent === sent);
}

/** What the change makes of what the window holds. */
function changed(held: Held, change: Change): Held {
  const { entries, version } = held.book;
  if ("lay" in change) {
    return moved(
      held,
      new Map(entries).set(change.lay.item.id, { ...change.lay, at: version + 1 }),
    );
  }
  if ("take" in change) {
    const found = entryOf(held, change.take.sent);
    if (found === undefined) return held;
    const [itemId, entry] = found;
    const taken = { ...entry, item: change.take.item, taken: true, at: version + 1 };
    return moved(held, new Map(entries).set(itemId, taken));
  }
  if ("refuse" in change) {
    const found = entryOf(held, change.refuse);
    if (found === undefined) return held;
    const kept = new Map(entries);
    kept.delete(found[0]);
    return moved(held, kept);
  }
  if ("leave" in change) {
    if (!held.words.has(change.leave)) return held;
    const words = new Map(held.words);
    words.delete(change.leave);
    return caughtUp({ ...held, words });
  }
  const { source, word, passed } = change.report;
  const said = held.words.get(source);
  const gone = [...passed].filter((itemId) => entries.has(itemId));
  if (said?.version === word.version && sameIds(said.behind, word.behind) && gone.length === 0) {
    return held;
  }
  const words = new Map(held.words).set(source, word);
  if (gone.length === 0) return caughtUp({ ...held, words });
  const kept = new Map(entries);
  for (const itemId of gone) kept.delete(itemId);
  return caughtUp(moved({ ...held, words }, kept));
}

/** What the window sent that the reads may not hold yet, kept for the window's life whichever page draws it. */
const settlingAtom: Atom.Writable<Held, Change> = Atom.keepAlive(
  Atom.writable(
    (): Held => NOTHING_HELD,
    (ctx, change: Change) => ctx.setSelf(changed(ctx.get(settlingAtom), change)),
  ),
);

/** How a read's item stands under an entry: the entry's item where the read is behind it, nothing where the read holds it, and passed where the read holds a newer revision. */
function overlaid(read: InboxItem, entry: Settling): InboxItem | "passed" | undefined {
  if (read.revision > entry.revision) return "passed";
  if (entry.kind === SETTLING.ANSWER) {
    return read.status === INBOX_STATUS.OPEN ? entry.item : undefined;
  }
  return read.updatedAt < entry.item.updatedAt ? entry.item : undefined;
}

/** A read's items with the entries laid over them: the very list where none is, and which the read is behind on and has passed. */
interface Laid<A> {
  readonly value: A;
  readonly behind: ReadonlySet<string>;
  readonly passed: ReadonlySet<string>;
}

/** The items as the window holds them, the entries laid over a read behind them. */
function laidItems(
  items: readonly InboxItem[],
  entries: ReadonlyMap<string, Settling>,
  behind: Set<string>,
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
    behind.add(read.id);
    moved = true;
    return over;
  });
  return moved ? laid : items;
}

/** Says, after each draw, which entries a read is behind on and which it has passed, and lets go of its word as it leaves. */
function useReport(
  version: number,
  behind: ReadonlySet<string>,
  passed: ReadonlySet<string>,
): void {
  const change = useAtomSet(settlingAtom);
  const source = useRef<Source>(Symbol("inbox read"));
  useEffect(() => {
    change({ report: { source: source.current, word: { behind, version }, passed } });
  }, [change, version, behind, passed]);
  useEffect(() => {
    const own = source.current;
    return () => change({ leave: own });
  }, [change]);
}

/** The book alone, so a read draws again only as an entry comes, goes, or is taken. */
function useBook(): Book {
  return useAtomValue(settlingAtom, (held) => held.book);
}

/** One read's items, the window's own answers and messages laid over them until the read holds them. */
export function useSettledItems(items: readonly InboxItem[]): readonly InboxItem[] {
  const { entries, version } = useBook();
  const laid = useMemo((): Laid<readonly InboxItem[]> => {
    const behind = new Set<string>();
    const passed = new Set<string>();
    const value = laidItems(items, entries, behind, passed);
    return {
      value,
      behind: behind.size === 0 ? NO_IDS : behind,
      passed: passed.size === 0 ? NO_IDS : passed,
    };
  }, [items, entries]);
  useReport(version, laid.behind, laid.passed);
  return laid.value;
}

/** Several reads' items, by task or by agent, each laid over as `useSettledItems` lays one. */
export function useSettledReads(
  reads: ReadonlyMap<string, readonly InboxItem[]>,
): ReadonlyMap<string, readonly InboxItem[]> {
  const { entries, version } = useBook();
  const laid = useMemo((): Laid<ReadonlyMap<string, readonly InboxItem[]>> => {
    const behind = new Set<string>();
    const passed = new Set<string>();
    let moved = false;
    const value = new Map(
      [...reads].map(([key, items]) => {
        const over = laidItems(items, entries, behind, passed);
        if (over !== items) moved = true;
        return [key, over] as const;
      }),
    );
    return {
      value: moved ? value : reads,
      behind: behind.size === 0 ? NO_IDS : behind,
      passed: passed.size === 0 ? NO_IDS : passed,
    };
  }, [reads, entries]);
  useReport(version, laid.behind, laid.passed);
  return laid.value;
}

/** What main's read says waits across the account, the items the window answered left out until main hears of it. */
export interface SettledWaiting {
  readonly waiting: readonly AppInboxTask[];
  readonly taskless: readonly AppInboxTasklessItem[];
}

/**
 * Main's read of what waits, the items the window answered left out until
 * main no longer lists them, so a count drops the moment an answer is sent.
 * Note that main names no revision, so an item the agent posted again
 * stands once a read of its items holds the newer revision, which lets go
 * of the answer laid over it.
 */
export function useSettledWaiting(
  waiting: readonly AppInboxTask[],
  taskless: readonly AppInboxTasklessItem[],
): SettledWaiting {
  const { entries, version } = useBook();
  const laid = useMemo((): Laid<SettledWaiting> => {
    // Note that an entry standing for a settled item hides it, a message laid since an answer among them.
    const answered = (itemId: string) => {
      const entry = entries.get(itemId);
      return entry !== undefined && entry.item.status !== INBOX_STATUS.OPEN;
    };
    const listed = [...waiting.flatMap((task) => task.items), ...taskless];
    const behind = new Set(listed.map((item) => item.id).filter(answered));
    if (behind.size === 0) return { value: { waiting, taskless }, behind: NO_IDS, passed: NO_IDS };
    const value = {
      waiting: waiting
        .map((task) => ({ ...task, items: task.items.filter((item) => !answered(item.id)) }))
        .filter((task) => task.items.length > 0),
      taskless: taskless.filter((item) => !answered(item.id)),
    };
    return { value, behind, passed: NO_IDS };
  }, [waiting, taskless, entries]);
  useReport(version, laid.behind, laid.passed);
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
  /** Lays a message's item as the service answered it, until the reads hold it. */
  readonly message: (item: InboxItem) => void;
  /** The service took the send: the item as it answered, laid until the reads hold it. */
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
