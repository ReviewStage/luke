import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import type { EntityKind, Refused, Written } from "@repo/sync";
import { Effect, type Scope } from "effect";
import { confirmWrite, type TxWait } from "./live-follow.js";

export const INBOX_CHANGE = {
  SETTLED: "settled",
  MARKED: "marked",
  REMINDED: "reminded",
  ANSWERED: "answered",
} as const;

export type InboxChange =
  | {
      readonly kind: typeof INBOX_CHANGE.SETTLED;
      readonly itemId: string;
      readonly item: (item: InboxItem) => InboxItem | undefined;
    }
  | {
      readonly kind: typeof INBOX_CHANGE.MARKED;
      readonly itemIds: ReadonlySet<string>;
      readonly unread: boolean;
    }
  | {
      readonly kind: typeof INBOX_CHANGE.REMINDED;
      readonly itemId: string;
      readonly until: number | null;
      readonly at: number;
    }
  | { readonly kind: typeof INBOX_CHANGE.ANSWERED; readonly item: InboxItem };

export interface InboxWritten {
  readonly txid: string | undefined;
  readonly item: InboxItem | undefined;
  readonly kept: boolean;
}

export function remindAtAfter(
  was: number | null | undefined,
  change: { readonly until: number | null; readonly at: number },
): number | undefined {
  if (change.until !== null) return change.until;
  if (was === undefined || was === null) return undefined;
  return Math.min(was, change.at);
}

function remindedItem(
  item: InboxItem,
  change: Extract<InboxChange, { readonly kind: typeof INBOX_CHANGE.REMINDED }>,
): InboxItem | undefined {
  const until = remindAtAfter(item.remindAt, change);
  if (item.remindAt === until) return undefined;
  const { remindAt: _was, ...rest } = item;
  return until === undefined ? rest : { ...rest, remindAt: until };
}

function changedItem(change: InboxChange, item: InboxItem): InboxItem | undefined {
  switch (change.kind) {
    case INBOX_CHANGE.SETTLED:
      return item.id === change.itemId && item.status === INBOX_STATUS.OPEN
        ? change.item(item)
        : undefined;
    case INBOX_CHANGE.MARKED:
      return change.itemIds.has(item.id) &&
        ((item.unread === true) !== change.unread || (item.markedUnread === true) !== change.unread)
        ? { ...item, unread: change.unread, markedUnread: change.unread }
        : undefined;
    case INBOX_CHANGE.REMINDED:
      return item.id === change.itemId ? remindedItem(item, change) : undefined;
    case INBOX_CHANGE.ANSWERED:
      return item.id === change.item.id && item.updatedAt <= change.item.updatedAt
        ? change.item
        : undefined;
  }
}

export function changedIds(change: InboxChange): readonly string[] {
  switch (change.kind) {
    case INBOX_CHANGE.SETTLED:
      return [change.itemId];
    case INBOX_CHANGE.MARKED:
      return [...change.itemIds];
    case INBOX_CHANGE.REMINDED:
      return [change.itemId];
    case INBOX_CHANGE.ANSWERED:
      return [change.item.id];
  }
}

export const INBOX_ITEM: EntityKind<InboxItem, InboxChange> = {
  key: (item) => item.id,
  drawn: (change, item) => (item === undefined ? undefined : changedItem(change, item)),
};

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

export function settles(change: InboxChange): boolean {
  if (change.kind === INBOX_CHANGE.SETTLED) return true;
  return change.kind === INBOX_CHANGE.ANSWERED && change.item.status !== INBOX_STATUS.OPEN;
}

export interface AccountWideReads {
  readonly stand: (wait: () => TxWait | undefined) => Effect.Effect<void, never, Scope.Scope>;
  readonly confirm: (txid: string | undefined) => Effect.Effect<void>;
}

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
