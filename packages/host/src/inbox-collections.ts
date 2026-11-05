/**
 * inbox-collections.ts -- an inbox item as the sync engine's pool holds it: one row however many inbox reads hold it, the changes a member's write draws over it, and the waits of the reads every inbox write on the account reaches.
 *
 * An item is a kind of the pool (`@repo/sync`), `INBOX_ITEM`: a plan's or
 * an agent's inbox (`scope-inbox-follow.ts`) and the account's feed of
 * every item (`account-items-follow.ts`) each stand on the items they
 * answer, so an item several reads hold, as the open task's inbox and the
 * feed both do, is one row, and a write over it reaches all of them. Main's
 * read of what waits (`account-inbox-follow.ts`) keeps its own brief
 * entries and per-task counts, and stands beside the pool, drawing the
 * writes standing over them itself.
 *
 * A member's write is declared by the agents composer (`compose-agents.ts`)
 * and drawn by the pool the moment it is asked, standing until each read it
 * changed carries its transaction, or taken back where the service refused
 * it. So a change is drawn again over each item a read takes while it
 * stands, and must leave an item the service already changed as it is.
 * Every txid an inbox write answers reaches every read holding its item: a
 * mark writes the reader's read row, which wakes the account and the item's
 * task and agent, and a nod, an answer, or a close writes the item, which
 * wakes every member's account, its task, and its agent. Where a read hands
 * no wait yet, as before Sync first woke it, the write's own answer is taken
 * in its place. From the service's answer on, a write stands as the item
 * the service answered, so a reply stays on its thread; and a write the
 * service did not take, the agent having changed the item first, takes the
 * item as the service answered it before it is taken back, so it lands on
 * the service's word.
 */

import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import type { EntityKind, Refused, Written } from "@repo/sync";
import { Effect, type Scope } from "effect";
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

/** What the service answered of a write: its transaction, the item as it then stands where it names one, and whether it was kept. */
export interface InboxWritten {
  readonly txid: string | undefined;
  readonly item: InboxItem | undefined;
  readonly kept: boolean;
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
      // Note that a mark sets the reader's own mark as well, since Open reads it on a closed thread.
      return change.itemIds.has(item.id) &&
        ((item.unread === true) !== change.unread || (item.markedUnread === true) !== change.unread)
        ? { ...item, unread: change.unread, markedUnread: change.unread }
        : undefined;
    case INBOX_CHANGE.ANSWERED:
      return item.id === change.item.id && item.updatedAt <= change.item.updatedAt
        ? change.item
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
  }
}

/** An inbox item as the pool holds it, by its id, every write to it a change the item's reads draw over it. */
export const INBOX_ITEM: EntityKind<InboxItem, InboxChange> = {
  key: (item) => item.id,
  drawn: (change, item) => (item === undefined ? undefined : changedItem(change, item)),
};

/**
 * What the service answered of a write on items, as the pool takes it:
 * kept on its transaction, standing as the item it names from then on, and
 * taken as that item in the place of a read that hands no wait; or refused,
 * landing on the item it names before it is taken back.
 */
export function inboxSent<Answer>(
  answer: Answer,
  written: InboxWritten,
): Written<InboxChange, Answer> | Refused<Answer, InboxChange> {
  const named: InboxChange | undefined =
    written.item === undefined ? undefined : { kind: INBOX_CHANGE.ANSWERED, item: written.item };
  if (!written.kept)
    return named === undefined ? { refused: answer } : { refused: answer, taken: named };
  const { txid } = written;
  return named === undefined ? { answer, txid } : { answer, txid, taken: named, standsAs: named };
}

/** Whether a change leaves the item no longer open: settled by the reader, or answered settled. */
export function settles(change: InboxChange): boolean {
  if (change.kind === INBOX_CHANGE.SETTLED) return true;
  return change.kind === INBOX_CHANGE.ANSWERED && change.item.status !== INBOX_STATUS.OPEN;
}

/** The account's own reads, every one of which any inbox write on the account wakes, and the waits they hand. */
export interface AccountWideReads {
  /** Stands a read's wait among the account's own for as long as the caller's scope. */
  readonly stand: (wait: () => TxWait | undefined) => Effect.Effect<void, never, Scope.Scope>;
  /** Waits for a write that draws nothing, as a thread started is, on every one of the account's own reads. */
  readonly confirm: (txid: string | undefined) => Effect.Effect<void>;
}

/** The account's own reads, none standing yet. */
export function accountWideReads(): AccountWideReads {
  const standing = new Set<() => TxWait | undefined>();
  return {
    stand: (wait) =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => standing.add(wait)),
          () => Effect.sync(() => standing.delete(wait)),
        ),
      ),
    confirm: (txid) =>
      Effect.forEach([...standing], (wait) => confirmWrite(wait(), txid), {
        concurrency: "unbounded",
        discard: true,
      }),
  };
}
