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
import { codingAgentMessagesAnswerSchema } from "./coding-agent-wire.js";
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

/**
 * The address a live read is answered at where it was read rather than
 * sealed: the reader asked to poll, or Realtime could not seal it. Each
 * statement then carries its rows, and nothing subscribes.
 */
export const LIVE_POLL_URL = "luke-poll:";

/**
 * The query every live read names the account it was started for under, as
 * Neon's guide says a page sends its user ("When the session changes"): the
 * service answers a session of anyone else, or a read naming none, as
 * signed out.
 */
export const LIVE_USER_QUERY = "userId";

/** A live read the service refused as signed out: no session, or one of another account than the read names. */
export const LIVE_SIGNED_OUT = { failure: "signed-out" } as const;

/** How a reader asks for a live read's rows inline rather than sealed, while Realtime fails it. */
export const LIVE_POLL = { QUERY: "poll", ON: "true" } as const;

/** One sealed statement as the service answers it, which Realtime's client subscribes to and renews with. */
export const sealedLiveQuerySchema = EffectSchema.Struct({
  capability: EffectSchema.String,
  queryFingerprint: EffectSchema.String,
  /** When the seal expires, in epoch milliseconds; the reader renews it before. */
  expiresAt: countedNumber,
  /**
   * The statement's rows as they stand, answered only at `LIVE_POLL_URL`.
   * They travel as JSON text, since a row has no wire form until its
   * reader decodes it.
   */
  rows: EffectSchema.optionalKey(
    EffectSchema.fromJsonString(EffectSchema.Array(EffectSchema.Unknown)),
  ),
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
 * One task's whiteboard sealed for following: the address, and one statement
 * that marks where the board stands. The desktop reads the board again once
 * the mark moves, rather than when a call's activity suggests it might have.
 * The service answers `not-found` for a task the account does not reach, and
 * `unavailable` where its deployment's Realtime is misconfigured, which the
 * desktop answers by asking again.
 */
export const taskBoardLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ board: sealedLiveQuerySchema }),
});

export type TaskBoardLiveAnswer = typeof taskBoardLiveAnswerSchema.Type;

/** The board as its row delivers it: Luke's latest drawing's number, the one the scene holds, and whether the scene holds its image. */
const taskBoardLiveRowSchema = EffectSchema.Struct({
  taskId: EffectSchema.String,
  drawingNumber: EffectSchema.Finite,
  appliedDrawing: EffectSchema.Finite,
  imaged: EffectSchema.Boolean,
});

/** The board's rows as Realtime delivers them: one, or none before the board was first written or for a task the account no longer reaches. */
export const taskBoardLiveRowsSchema = EffectSchema.Struct({
  board: EffectSchema.Array(taskBoardLiveRowSchema),
});

export type TaskBoardLiveRows = typeof taskBoardLiveRowsSchema.Type;

/**
 * A coding agent's transcript, or one of its workers', sealed for
 * following: the address, and the statements a page past the reader's
 * cursor is read from, which move where the service's held read would wake
 * (`packages/service/src/agents/coder-host/transcript-live.ts`): its
 * messages, its turns, its conversation's journal revision and title, the
 * agent's title, and its workers' titles and delegations. The page itself
 * is still read from the service, once they move. The service answers
 * `not-found` for an agent the account does not reach, and `unavailable`
 * where its deployment's Realtime is misconfigured, which the desktop
 * answers by asking again.
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
      id: EffectSchema.String,
      title: EffectSchema.NullOr(EffectSchema.String),
      revision: countedNumber,
    }),
  ),
  agent: EffectSchema.Array(
    EffectSchema.Struct({
      id: EffectSchema.String,
      title: EffectSchema.NullOr(EffectSchema.String),
    }),
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
 * reader waits for the statements to move before it reads again.
 */
export const transcriptNowAnswerSchema = EffectSchema.Struct({
  ...codingAgentMessagesAnswerSchema.fields,
  holds: EffectSchema.Boolean,
});

export type TranscriptNowAnswer = typeof transcriptNowAnswerSchema.Type;
