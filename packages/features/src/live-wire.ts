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
 * `unavailable` where its deployment has no Realtime, and the desktop holds
 * its read open as it did before.
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

/**
 * The account inbox's answer as the live rows stand at `now`: the parts
 * ordered as the held read orders them, an item with no workspace said as
 * none, and the failed runs kept to the last week, which the held read
 * bounds in its statement and a live statement cannot. The cursor is the
 * held read's alone, so a live answer carries none.
 */
export function accountInboxOfLiveRows(
  rows: AccountInboxLiveRows,
  now: number,
): AccountInboxAnswer {
  return {
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
    cursor: "",
    readAt: now,
  };
}
