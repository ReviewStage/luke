import { Schema as EffectSchema } from "effect";
import {
  type AccountChatEntry,
  type AccountFailedRun,
  type AccountInboxAnswer,
  type AccountInboxAutomation,
  type AccountInboxEntry,
  type AccountInboxTask,
  accountChatEntrySchema,
  accountFailedRunSchema,
  accountInboxAutomationSchema,
  accountInboxEntrySchema,
  accountInboxTaskSchema,
  accountTasklessEntrySchema,
} from "./account-inbox-wire.js";
import {
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  inboxAnswerFileSchema,
  inboxItemSchema,
  inboxMessageSchema,
  inboxReplySchema,
} from "./inbox-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * live-wire.ts -- a read the desktop follows over Neon Realtime: the sealed statements the service answers, and the rows they deliver.
 *
 * Neon's guide is followed as written: the service builds each statement
 * with the account's id in it and seals it ("Sealing authorized queries"),
 * the desktop fetches the sealed statements from an endpoint ("Fetch from an
 * API endpoint"), subscribes to them at the address the answer names, and
 * renews them before they expire ("Renew the sealed query"). A sealed
 * statement is a short-lived bearer: it is held where the account's own
 * bearer is, in the desktop's host, and never carried on to a window.
 *
 * The rows are the wire's own entries, since the service writes each live
 * statement to select every column under the key the wire reads it by and
 * each instant as epoch milliseconds. Realtime keeps no order, so the
 * reader orders them as the held read does.
 */

/** One sealed statement as the service answers it, which Realtime's client subscribes to and renews with. */
export const sealedLiveQuerySchema = EffectSchema.Struct({
  capability: EffectSchema.String,
  queryFingerprint: EffectSchema.String,
  /** When the seal expires, in epoch milliseconds; the reader renews it before. */
  expiresAt: countedNumber,
});

export type SealedLiveQueryWire = typeof sealedLiveQuerySchema.Type;

/**
 * What waits on the developer across the account, sealed for following: the
 * address to subscribe at, and one statement per part of the account
 * inbox's answer (`account-inbox-wire.ts`), what waits in chat as two: the
 * open asks, and the messages the account's people were told of. The service answers
 * `unavailable` where its deployment's Realtime is misconfigured, which the
 * desktop answers by asking again.
 */
export const accountInboxLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    items: sealedLiveQuerySchema,
    planless: sealedLiveQuerySchema,
    plans: sealedLiveQuerySchema,
    automations: sealedLiveQuerySchema,
    failedRuns: sealedLiveQuerySchema,
    chatAsks: sealedLiveQuerySchema,
    chatNotices: sealedLiveQuerySchema,
  }),
});

export type AccountInboxLiveAnswer = typeof accountInboxLiveAnswerSchema.Type;

/** An item of an agent with no plan as its row delivers it: the workspace as the column holds it, null for none. */
const tasklessLiveRowSchema = EffectSchema.Struct({
  ...accountTasklessEntrySchema.fields,
  workspaceId: EffectSchema.NullOr(EffectSchema.String),
});

/** Each part's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const accountInboxLiveRowSchemas = {
  items: accountInboxEntrySchema,
  planless: tasklessLiveRowSchema,
  plans: accountInboxTaskSchema,
  automations: accountInboxAutomationSchema,
  failedRuns: accountFailedRunSchema,
  chatAsks: accountChatEntrySchema,
  chatNotices: accountChatEntrySchema,
} as const;

/** Each part's rows, decoded. */
export interface AccountInboxLiveRows {
  readonly items: readonly AccountInboxEntry[];
  readonly planless: readonly (typeof tasklessLiveRowSchema.Type)[];
  readonly plans: readonly AccountInboxTask[];
  readonly automations: readonly AccountInboxAutomation[];
  readonly failedRuns: readonly AccountFailedRun[];
  readonly chatAsks: readonly AccountChatEntry[];
  readonly chatNotices: readonly AccountChatEntry[];
}

/** How far back a run that failed to start is still carried to its automation's owner. */
export const FAILED_RUN_WINDOW_MILLIS = 7 * 24 * 60 * 60 * 1000;

/** The latest changed first, and by id among those changed at one instant, as the held read orders them. */
function latestFirst<Row extends { readonly updatedAt: number }>(
  key: (row: Row) => string,
): (a: Row, b: Row) => number {
  return (a, b) => {
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    const [left, right] = [key(a), key(b)];
    return left < right ? 1 : left > right ? -1 : 0;
  };
}

/** The latest changed first, then the latest place, then by id, as `waitingOn` orders the asks. */
function latestChatFirst(a: AccountChatEntry, b: AccountChatEntry): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.touchedSeq !== b.touchedSeq) return b.touchedSeq - a.touchedSeq;
  return a.messageId < b.messageId ? 1 : a.messageId > b.messageId ? -1 : 0;
}

/**
 * What waits in chat as `chat-waiting.ts` answers it from the live rows: the
 * open asks, then each notice that is not of an ask already, which is said
 * once as the ask, the latest changed first.
 */
function chatOfLiveRows(
  asks: readonly AccountChatEntry[],
  notices: readonly AccountChatEntry[],
): readonly AccountChatEntry[] {
  const asked = new Set(asks.map((entry) => entry.messageId));
  return [
    ...asks.toSorted(latestChatFirst),
    ...notices.filter((entry) => !asked.has(entry.messageId)).toSorted(latestChatFirst),
  ].toSorted((one, other) => other.updatedAt - one.updatedAt);
}

/** A short, stable digest of a text: cyrb53, which needs no platform hash, since the host also runs in a browser tab. */
function digest(text: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(16);
}

/**
 * The cursor of a live answer: a digest of what the held read's cursor
 * stamps, each item's id, revision, instant, and read state, each failed
 * run, and each chat entry where it stands, so an answer whose cursor is
 * the last one's moved nothing a reader announces or counts, as a held
 * answer's does.
 */
function liveCursorOf(answer: Omit<AccountInboxAnswer, "cursor" | "readAt">): string {
  const itemStamp = (item: {
    readonly id: string;
    readonly revision: number;
    readonly updatedAt: number;
    readonly unread?: boolean | undefined;
  }) => [item.id, item.revision, item.updatedAt, item.unread ?? null];
  return digest(
    JSON.stringify([
      answer.items.map(itemStamp),
      (answer.planless ?? []).map(itemStamp),
      (answer.failedRuns ?? []).map((run) => [run.id, run.failedAt]),
      (answer.chat ?? []).map((entry) => [
        entry.messageId,
        entry.reason,
        entry.touchedSeq,
        entry.updatedAt,
      ]),
    ]),
  );
}

/**
 * The account inbox's answer as the live rows stand at `now`: the parts
 * ordered as the held read orders them, an item with no workspace said as
 * none, and the failed runs kept to the last week, which the held read
 * bounds in its statement and a live statement cannot. Its cursor is a
 * digest of what it holds (`liveCursorOf`), which moves wherever the held
 * read's would, though the two are never compared.
 */
export function accountInboxOfLiveRows(
  rows: AccountInboxLiveRows,
  now: number,
): AccountInboxAnswer {
  const answer = {
    items: rows.items.toSorted(latestFirst((item) => item.id)),
    plans: rows.plans.toSorted(latestFirst((plan) => plan.planId)),
    planless: rows.planless
      .map(({ workspaceId, ...item }) => (workspaceId === null ? item : { ...item, workspaceId }))
      .toSorted(latestFirst((item) => item.id)),
    automations: rows.automations.toSorted(
      latestFirst((automation) => automation.automationId ?? ""),
    ),
    failedRuns: rows.failedRuns
      .filter((run) => run.failedAt >= now - FAILED_RUN_WINDOW_MILLIS)
      .toSorted((a, b) => b.failedAt - a.failedAt),
    chat: chatOfLiveRows(rows.chatAsks, rows.chatNotices),
  };
  return { ...answer, cursor: liveCursorOf(answer), readAt: now };
}

/**
 * When the earliest failed run the rows carry at `now` ages out of the last
 * week, in epoch milliseconds; none where they carry none. Nothing a live
 * statement delivers says so, since Realtime follows no clock, so the
 * follower publishes again then.
 */
export function nextFailedRunExpiry(
  failedRuns: readonly AccountFailedRun[],
  now: number,
): number | undefined {
  const expiries = failedRuns
    .map((run) => run.failedAt + FAILED_RUN_WINDOW_MILLIS)
    .filter((expiry) => expiry > now);
  return expiries.length === 0 ? undefined : Math.min(...expiries);
}

/**
 * One plan's inbox, or one agent's, sealed for following: the address, and
 * its open items and its latest settled ones as one statement, as the held
 * read reads them, so an item settling moves in one change. The service answers `not-found` for a plan or agent the
 * account does not reach, and `unavailable` where its deployment has no
 * Realtime, and the desktop holds its read open as before.
 */
export const scopeInboxLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ items: sealedLiveQuerySchema }),
});

export type ScopeInboxLiveAnswer = typeof scopeInboxLiveAnswerSchema.Type;

/** One message of an item's thread as its row carries it: the member by id and name, either null where none stands, and its files, empty where it carried none. */
const inboxLiveMessageSchema = EffectSchema.Struct({
  id: inboxMessageSchema.fields.id,
  author: inboxMessageSchema.fields.author,
  userId: EffectSchema.NullOr(EffectSchema.String),
  name: EffectSchema.NullOr(EffectSchema.String),
  text: EffectSchema.String,
  files: EffectSchema.Array(inboxAnswerFileSchema),
  createdAt: countedNumber,
});

/** One item as its row delivers it: what an item leaves out where it holds nothing is null, or empty for a list. */
const inboxLiveRowSchema = EffectSchema.Struct({
  ...inboxItemSchema.fields,
  startedBy: EffectSchema.String,
  startedByName: EffectSchema.NullOr(EffectSchema.String),
  answer: EffectSchema.NullOr(inboxReplySchema),
  answerFiles: EffectSchema.Array(inboxAnswerFileSchema),
  answeredBy: EffectSchema.NullOr(EffectSchema.String),
  answeredByName: EffectSchema.NullOr(EffectSchema.String),
  closedReason: EffectSchema.NullOr(EffectSchema.String),
  messages: EffectSchema.Array(inboxLiveMessageSchema),
  settledAt: EffectSchema.NullOr(countedNumber),
  unread: EffectSchema.Boolean,
});

/** A scope's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const scopeInboxLiveRowsSchema = EffectSchema.Struct({
  items: EffectSchema.Array(inboxLiveRowSchema),
});

type InboxLiveRow = typeof inboxLiveRowSchema.Type;

/** A message as the wire carries it, the member named where their account stands and no files where it carried none, as the held read writes it. */
function inboxMessageOfLiveRow(row: typeof inboxLiveMessageSchema.Type): InboxMessage {
  return {
    id: row.id,
    author: row.author,
    ...(row.userId === null || row.name === null
      ? undefined
      : { member: { userId: row.userId, name: row.name } }),
    text: row.text,
    ...(row.files.length === 0 ? undefined : { files: row.files }),
    createdAt: row.createdAt,
  };
}

/** A row as the wire carries its item, each absent field left out rather than null, as the held read writes it. */
function inboxItemOfLiveRow(row: InboxLiveRow): InboxItem {
  const {
    startedBy,
    startedByName,
    answer,
    answerFiles,
    answeredBy,
    answeredByName,
    closedReason,
    messages,
    settledAt,
    ...item
  } = row;
  return {
    ...item,
    ...(startedByName === null
      ? undefined
      : { startedBy: { userId: startedBy, name: startedByName } }),
    ...(answer === null ? undefined : { answer }),
    ...(answerFiles.length === 0 ? undefined : { answerFiles }),
    ...(answeredBy === null || answeredByName === null
      ? undefined
      : { answeredBy: { userId: answeredBy, name: answeredByName } }),
    ...(closedReason === null ? undefined : { closedReason }),
    ...(messages.length === 0 ? undefined : { messages: messages.map(inboxMessageOfLiveRow) }),
    ...(settledAt === null ? undefined : { settledAt }),
  };
}

/** The scope's items as the held read answers them: every open one, then the latest settled, each the latest changed first. */
export function inboxOfLiveRows(rows: typeof scopeInboxLiveRowsSchema.Type): readonly InboxItem[] {
  const ordered = latestFirst((item: InboxItem) => item.id);
  const items = rows.items.map(inboxItemOfLiveRow);
  return [
    ...items.filter((item) => item.status === INBOX_STATUS.OPEN).toSorted(ordered),
    ...items.filter((item) => item.status !== INBOX_STATUS.OPEN).toSorted(ordered),
  ];
}
