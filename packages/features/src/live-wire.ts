import { Schema as EffectSchema } from "effect";
import {
  type AccountFailedRun,
  type AccountInboxAnswer,
  type AccountInboxAutomation,
  type AccountInboxEntry,
  type AccountInboxTask,
  accountFailedRunSchema,
  accountInboxAutomationSchema,
  accountInboxEntrySchema,
  accountInboxTaskSchema,
  accountTasklessEntrySchema,
} from "./account-inbox-wire.js";
import { codingAgentMessagesAnswerSchema } from "./coding-agent-wire.js";
import { INBOX_STATUS, type InboxItem, inboxItemSchema, inboxReplySchema } from "./inbox-wire.js";
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
 * inbox's answer (`account-inbox-wire.ts`). The service answers
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
} as const;

/** Each part's rows, decoded. */
export interface AccountInboxLiveRows {
  readonly items: readonly AccountInboxEntry[];
  readonly planless: readonly (typeof tasklessLiveRowSchema.Type)[];
  readonly plans: readonly AccountInboxTask[];
  readonly automations: readonly AccountInboxAutomation[];
  readonly failedRuns: readonly AccountFailedRun[];
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
    cursor: "",
    readAt: now,
  };
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

/** One item as its row delivers it: what an item leaves out where it holds nothing is null. */
const inboxLiveRowSchema = EffectSchema.Struct({
  ...inboxItemSchema.fields,
  answer: EffectSchema.NullOr(inboxReplySchema),
  answeredBy: EffectSchema.NullOr(EffectSchema.String),
  answeredByName: EffectSchema.NullOr(EffectSchema.String),
  closedReason: EffectSchema.NullOr(EffectSchema.String),
});

/** A scope's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const scopeInboxLiveRowsSchema = EffectSchema.Struct({
  items: EffectSchema.Array(inboxLiveRowSchema),
});

type InboxLiveRow = typeof inboxLiveRowSchema.Type;

/** A row as the wire carries its item, each absent field left out rather than null, as the held read writes it. */
function inboxItemOfLiveRow(row: InboxLiveRow): InboxItem {
  const { answer, answeredBy, answeredByName, closedReason, ...item } = row;
  return {
    ...item,
    ...(answer === null ? undefined : { answer }),
    ...(answeredBy === null || answeredByName === null
      ? undefined
      : { answeredBy: { userId: answeredBy, name: answeredByName } }),
    ...(closedReason === null ? undefined : { closedReason }),
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

/**
 * A coding agent's transcript, or one of its workers', sealed for
 * following: the address, and the statements a page past the reader's
 * cursor is read from, which move where the service's held read would wake
 * (`packages/service/src/agents/coder-host/transcript-live.ts`): its
 * messages, its turns, its conversation's journal revision and title, the
 * agent's title, and its workers' titles and delegations. The page itself
 * is still read from the service, once they move. The service answers
 * `not-found` for an agent the account does not reach, and `unavailable`
 * where its deployment has no Realtime, and the desktop holds its read open
 * as before.
 */
export const agentTranscriptLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    messages: sealedLiveQuerySchema,
    turns: sealedLiveQuerySchema,
    conversation: sealedLiveQuerySchema,
    agent: sealedLiveQuerySchema,
    workers: sealedLiveQuerySchema,
  }),
});

export type AgentTranscriptLiveAnswer = typeof agentTranscriptLiveAnswerSchema.Type;

/** A transcript's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const agentTranscriptLiveRowsSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(EffectSchema.Struct({ rows: countedNumber, seq: countedNumber })),
  turns: EffectSchema.Array(
    EffectSchema.Struct({
      status: EffectSchema.String,
      rows: countedNumber,
      stopped: countedNumber,
      changedAt: countedNumber,
    }),
  ),
  conversation: EffectSchema.Array(
    EffectSchema.Struct({
      title: EffectSchema.NullOr(EffectSchema.String),
      revision: countedNumber,
    }),
  ),
  agent: EffectSchema.Array(
    EffectSchema.Struct({ title: EffectSchema.NullOr(EffectSchema.String) }),
  ),
  workers: EffectSchema.Array(
    EffectSchema.Struct({
      id: EffectSchema.String,
      title: EffectSchema.NullOr(EffectSchema.String),
      callId: EffectSchema.NullOr(EffectSchema.String),
    }),
  ),
});

/** The query a transcript read is asked at once by rather than held, and the one word it takes. */
export const TRANSCRIPT_NOW_QUERY = { WAIT: "wait", NONE: "none" } as const;

/**
 * A page of the transcript read at once rather than held, for a reader
 * following its live statements: the page the held read answers, and
 * whether that read would have held on it for more, which is when the
 * reader waits for the statements to move, or for the clock to reach an
 * edge the rows cannot say, before it reads again.
 */
export const transcriptNowAnswerSchema = EffectSchema.Struct({
  ...codingAgentMessagesAnswerSchema.fields,
  holds: EffectSchema.Boolean,
  /**
   * Where it would hold, how many milliseconds from now the clock alone may
   * end that, which no row changing says: an agent passing the grace its
   * first turn had to land in, or the window of a title it waits on
   * closing. The reader reads again then. Absent where only a row may, and
   * from a service older than it.
   */
  wakeIn: EffectSchema.optionalKey(countedNumber),
});

export type TranscriptNowAnswer = typeof transcriptNowAnswerSchema.Type;
