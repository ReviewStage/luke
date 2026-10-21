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
  type ChatAnswer,
  type ChatChannel,
  type ChatMember,
  type ChatMessage,
  chatChannelSchema,
  chatMemberSchema,
  chatMessageAskSchema,
  chatMessageSchema,
} from "./chat-wire.js";
import { codingAgentMessagesAnswerSchema } from "./coding-agent-wire.js";
import {
  INBOX_BOUNDS,
  INBOX_STATUS,
  type InboxAskStanding,
  type InboxItem,
  type InboxMessage,
  inboxAnswerFileSchema,
  inboxAnswersSchema,
  inboxItemSchema,
  inboxMessageSchema,
  inboxReadAskSchema,
  inboxReplySchema,
  standingAsk,
} from "./inbox-wire.js";
import { MAC_COMMAND_KIND, type MacCommand, macCommandSchema } from "./mac-command-wire.js";
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

/** How a reader asks for a live read's rows inline rather than sealed, while Realtime fails it. */
export const LIVE_POLL = { QUERY: "poll", ON: "true", AFTER: "after" } as const;

/**
 * The query every live read names the account it was started for under, as
 * Neon's guide says a page sends its user ("When the session changes"): the
 * service answers a session of anyone else, or a read naming none, as
 * signed out.
 */
export const LIVE_USER_QUERY = "userId";

/** A live read the service refused as signed out: no session, or one of another account than the read names. */
export const LIVE_SIGNED_OUT = { failure: "signed-out" } as const;

/**
 * Where a polled read's rows stand as one value: each part's digest, in
 * the parts' name order. A reader sends the one it last saw as `after`, and
 * the service holds the poll until the rows move past it.
 */
export function liveDigestOf(
  queries: Readonly<Record<string, { readonly digest?: string }>>,
): string | undefined {
  const parts = Object.keys(queries).toSorted();
  const digests = parts.map((part) => queries[part]?.digest);
  return digests.every((digest) => digest !== undefined) ? digests.join(",") : undefined;
}

/** One sealed statement as the service answers it, which Realtime's client subscribes to and renews with. */
const sealedLiveQuerySchema = EffectSchema.Struct({
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
  /**
   * Where the statement's rows stand, answered only at `LIVE_POLL_URL`: a
   * poll held past `after` that ends with nothing moved carries the digest
   * and no rows.
   */
  digest: EffectSchema.optionalKey(EffectSchema.String),
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
 * An open task's pages, calls, and agents' code sealed for following: the
 * address, and one statement a part, each a mark that moves as its rows do
 * and carries none of their words: the pages agents showed (`pages`), the
 * calls about the task (`calls`), and the `show_code` calls its agents'
 * journals answered (`code`). The desktop reads a part again once its mark moves,
 * rather than when a call's activity or end suggests it might have; the
 * board is followed on its own (`taskBoardLiveAnswerSchema`). The service
 * answers `not-found` for a task the account does not reach, and
 * `unavailable` where its deployment's Realtime is misconfigured, which the
 * desktop answers by asking again.
 */
export const taskRecordLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    pages: sealedLiveQuerySchema,
    calls: sealedLiveQuerySchema,
    code: sealedLiveQuerySchema,
  }),
});

export type TaskRecordLiveAnswer = typeof taskRecordLiveAnswerSchema.Type;

/** One page shown on the task as its row delivers it: its newest version's number. */
const taskPageLiveRowSchema = EffectSchema.Struct({
  pageId: EffectSchema.String,
  version: EffectSchema.Finite,
});

/** One call about the task as its row delivers it: when and how it ended, null while it stands; what it metered and its model; its last fragment; and how many rows the voice wrote for it. */
const taskCallLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  closedAt: EffectSchema.NullOr(EffectSchema.Finite),
  closeReason: EffectSchema.NullOr(EffectSchema.String),
  usage: EffectSchema.NullOr(
    EffectSchema.Struct({ seconds: EffectSchema.Finite, confirmed: EffectSchema.Boolean }),
  ),
  model: EffectSchema.NullOr(EffectSchema.String),
  lastSegment: EffectSchema.Finite,
  spoken: EffectSchema.Finite,
});

/** One journal of an agent on the task as its row delivers it: the ids of the `show_code` calls it answered with lines, as JSON text. */
const taskCodeLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  calls: EffectSchema.String,
});

/** The task's pages, calls, and agents' code as Realtime delivers them, a part's rows each: none of any for a task the account no longer reaches. */
export const taskRecordLiveRowsSchema = EffectSchema.Struct({
  pages: EffectSchema.Array(taskPageLiveRowSchema),
  calls: EffectSchema.Array(taskCallLiveRowSchema),
  code: EffectSchema.Array(taskCodeLiveRowSchema),
});

export type TaskRecordLiveRows = typeof taskRecordLiveRowsSchema.Type;

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

/**
 * The commands the account's agents queued for its Mac, of the kinds it
 * runs, sealed for following: the address, and the commands no Mac has
 * claimed yet as one statement. The Mac claims each it hears of
 * (`mac-command-wire.ts`), on the service's clock, so a command left waiting
 * too long is refused there.
 */
export const macCommandsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ commands: sealedLiveQuerySchema }),
});

export type MacCommandsLiveAnswer = typeof macCommandsLiveAnswerSchema.Type;

const [macShellCommandSchema, macBrowserCommandSchema] = macCommandSchema.members;

/**
 * One unclaimed command as its row delivers it: the command of its kind, and
 * when it was queued in epoch milliseconds. Note that the column the other
 * kind leaves null is read past, as every key a struct does not name is.
 */
const macCommandLiveRowSchema = EffectSchema.Union([
  EffectSchema.Struct({ ...macShellCommandSchema.fields, queuedAt: countedNumber }),
  EffectSchema.Struct({ ...macBrowserCommandSchema.fields, queuedAt: countedNumber }),
]);

/** The unclaimed commands as Realtime delivers them, decoded at the boundary before anything reads them. */
export const macCommandsLiveRowsSchema = EffectSchema.Struct({
  commands: EffectSchema.Array(macCommandLiveRowSchema),
});

/** The unclaimed commands, the earliest queued first, so the Mac claims them in the order they were asked for. */
export function macCommandsOfLiveRows(
  rows: typeof macCommandsLiveRowsSchema.Type,
): readonly MacCommand[] {
  return rows.commands
    .toSorted((a, b) =>
      a.queuedAt !== b.queuedAt ? a.queuedAt - b.queuedAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )
    .map(
      (row): MacCommand =>
        row.kind === MAC_COMMAND_KIND.SHELL
          ? { id: row.id, kind: row.kind, command: row.command, timeoutSeconds: row.timeoutSeconds }
          : { id: row.id, kind: row.kind, params: row.params, timeoutSeconds: row.timeoutSeconds },
    );
}

/**
 * One plan's inbox, or one agent's, sealed for following: the address, and
 * its open items and its latest settled ones as one statement, as the held
 * read reads them, so an item settling moves in one change, with their
 * threads' latest messages and the files their answers and messages
 * carried as two more, which the reader joins to them. The service answers
 * `not-found` for a plan or agent the account does not reach, and
 * `unavailable` where its deployment's Realtime is misconfigured, which the
 * desktop answers by asking again.
 */
export const scopeInboxLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    items: sealedLiveQuerySchema,
    messages: sealedLiveQuerySchema,
    files: sealedLiveQuerySchema,
  }),
});

export type ScopeInboxLiveAnswer = typeof scopeInboxLiveAnswerSchema.Type;

/** One message of an item's thread as its row carries it: its item, and the member by id and name, either null where none stands. */
const inboxLiveMessageSchema = EffectSchema.Struct({
  id: inboxMessageSchema.fields.id,
  itemId: EffectSchema.String,
  author: inboxMessageSchema.fields.author,
  userId: EffectSchema.NullOr(EffectSchema.String),
  name: EffectSchema.NullOr(EffectSchema.String),
  text: EffectSchema.String,
  ask: EffectSchema.NullOr(inboxReadAskSchema),
  answers: EffectSchema.NullOr(inboxAnswersSchema),
  createdAt: countedNumber,
});

/** One file as its row carries it: the item whose answer carried it, or the message that did, and where it stands among them. */
const inboxLiveFileSchema = EffectSchema.Struct({
  ...inboxAnswerFileSchema.fields,
  answerOf: EffectSchema.NullOr(EffectSchema.String),
  messageId: EffectSchema.NullOr(EffectSchema.String),
  position: EffectSchema.NullOr(countedNumber),
});

/** One item as its row delivers it: what an item leaves out where it holds nothing is null. */
const inboxLiveRowSchema = EffectSchema.Struct({
  ...inboxItemSchema.fields,
  startedBy: EffectSchema.String,
  startedByName: EffectSchema.NullOr(EffectSchema.String),
  answer: EffectSchema.NullOr(inboxReplySchema),
  answeredBy: EffectSchema.NullOr(EffectSchema.String),
  answeredByName: EffectSchema.NullOr(EffectSchema.String),
  closedReason: EffectSchema.NullOr(EffectSchema.String),
  closedBy: EffectSchema.NullOr(EffectSchema.String),
  closedByName: EffectSchema.NullOr(EffectSchema.String),
  openAskMessageId: EffectSchema.NullOr(EffectSchema.String),
  settledAt: EffectSchema.NullOr(countedNumber),
  unread: EffectSchema.Boolean,
});

/** A scope's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const scopeInboxLiveRowsSchema = EffectSchema.Struct({
  items: EffectSchema.Array(inboxLiveRowSchema),
  messages: EffectSchema.Array(inboxLiveMessageSchema),
  files: EffectSchema.Array(inboxLiveFileSchema),
});

type InboxLiveRows = typeof scopeInboxLiveRowsSchema.Type;
type InboxLiveRow = typeof inboxLiveRowSchema.Type;
type InboxLiveMessage = typeof inboxLiveMessageSchema.Type;
type InboxLiveFile = typeof inboxLiveFileSchema.Type;

/** The rows grouped under a key each names, a row naming none left out. */
function groupedBy<Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string | null,
): ReadonlyMap<string, readonly Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

/** Files in the order they were attached, each as the wire names it, as the held read lists them. */
function filesInOrder(files: readonly InboxLiveFile[] | undefined) {
  return (files ?? [])
    .toSorted((one, other) => (one.position ?? Infinity) - (other.position ?? Infinity))
    .map(({ attachmentId, name, mediaType }) => ({ attachmentId, name, mediaType }));
}

/** A message as the wire carries it, the member named where their account stands, no files where it carried none, and its ask as it stands on the item, as the held read writes it. */
function inboxMessageOfLiveRow(
  row: InboxLiveMessage,
  filesOf: ReadonlyMap<string, readonly InboxLiveFile[]>,
  item: InboxAskStanding,
): InboxMessage {
  const files = filesInOrder(filesOf.get(row.id));
  return {
    id: row.id,
    author: row.author,
    ...(row.userId === null || row.name === null
      ? undefined
      : { member: { userId: row.userId, name: row.name } }),
    text: row.text,
    ...(files.length === 0 ? undefined : { files }),
    ...(row.ask === null ? undefined : { ask: standingAsk(row.ask, row.id, item) }),
    ...(row.answers === null ? undefined : { answers: row.answers }),
    createdAt: row.createdAt,
  };
}

/**
 * An item's two threads from its delivered messages, oldest first, as the
 * held read carries them: the latest `MAX_MESSAGES_READ` that neither ask
 * nor answer, and the whole thread, its latest messages with its first and
 * the one whose ask it holds open however many came since.
 */
function threadsOf(messages: readonly InboxLiveMessage[], openAskMessageId: string | null) {
  const ordered = messages.toSorted(threadOrder);
  const bound = INBOX_BOUNDS.MAX_MESSAGES_READ;
  const plain = ordered.filter((each) => each.ask === null && each.answers === null).slice(-bound);
  const latest = new Set(ordered.slice(-bound).map((each) => each.id));
  const firstId = ordered[0]?.id;
  const thread = ordered.filter(
    (each) => latest.has(each.id) || each.id === firstId || each.id === openAskMessageId,
  );
  return { plain, thread };
}

/** A thread's messages oldest first, as the held read orders them. */
function threadOrder(one: InboxLiveMessage, other: InboxLiveMessage): number {
  if (one.createdAt !== other.createdAt) return one.createdAt - other.createdAt;
  return one.id < other.id ? -1 : one.id > other.id ? 1 : 0;
}

/** A row as the wire carries its item, its threads and files joined to it, each absent field left out rather than null, as the held read writes it. */
function inboxItemOfLiveRow(
  row: InboxLiveRow,
  threads: ReadonlyMap<string, readonly InboxLiveMessage[]>,
  answerFilesOf: ReadonlyMap<string, readonly InboxLiveFile[]>,
  messageFilesOf: ReadonlyMap<string, readonly InboxLiveFile[]>,
): InboxItem {
  const {
    startedBy,
    startedByName,
    answer,
    answeredBy,
    answeredByName,
    closedReason,
    closedBy,
    closedByName,
    openAskMessageId,
    settledAt,
    ...item
  } = row;
  const answerFiles = filesInOrder(answerFilesOf.get(row.id));
  const { plain, thread } = threadsOf(threads.get(row.id) ?? [], openAskMessageId);
  const message = (each: InboxLiveMessage) =>
    inboxMessageOfLiveRow(each, messageFilesOf, {
      status: row.status,
      response: row.response,
      openAskMessageId,
      closedReason,
    });
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
    ...(closedBy === null || closedByName === null
      ? undefined
      : { closedBy: { userId: closedBy, name: closedByName } }),
    ...(plain.length === 0 ? undefined : { messages: plain.map(message) }),
    ...(thread.length === 0 ? undefined : { thread: thread.map(message) }),
    ...(settledAt === null ? undefined : { settledAt }),
  };
}

/** The scope's items as the held read answers them: every open one, then the latest settled, each the latest changed first. */
export function inboxOfLiveRows(rows: InboxLiveRows): readonly InboxItem[] {
  const ordered = latestFirst((item: InboxItem) => item.id);
  const threads = groupedBy(rows.messages, (message) => message.itemId);
  const answerFilesOf = groupedBy(rows.files, (file) => file.answerOf);
  const messageFilesOf = groupedBy(rows.files, (file) => file.messageId);
  const items = rows.items.map((row) =>
    inboxItemOfLiveRow(row, threads, answerFilesOf, messageFilesOf),
  );
  return [
    ...items.filter((item) => item.status === INBOX_STATUS.OPEN).toSorted(ordered),
    ...items.filter((item) => item.status !== INBOX_STATUS.OPEN).toSorted(ordered),
  ];
}

/**
 * A workspace's chat sealed for following, as its reader reads it: the
 * address, and one statement per part of the window's read: the reader's
 * own member and how far it has read, every member, every channel, the
 * newest messages it sees of each channel, and each channel it has read on that channel's own
 * cursor. The service answers `not-found` for a workspace the account is
 * not in or whose chat it has not joined, and `unavailable` where its
 * deployment's Realtime is misconfigured, which the desktop answers by
 * asking again.
 */
export const workspaceChatLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    self: sealedLiveQuerySchema,
    members: sealedLiveQuerySchema,
    channels: sealedLiveQuerySchema,
    messages: sealedLiveQuerySchema,
    reads: sealedLiveQuerySchema,
  }),
});

/** A member as its row delivers it: what it stands for and what it is called null where it has none, and the keys the roster is ordered by. */
const chatMemberLiveRowSchema = EffectSchema.Struct({
  id: chatMemberSchema.fields.id,
  kind: chatMemberSchema.fields.kind,
  handle: EffectSchema.String,
  name: EffectSchema.NullOr(EffectSchema.String),
  left: chatMemberSchema.fields.left,
  userId: EffectSchema.NullOr(EffectSchema.String),
  agentId: EffectSchema.NullOr(chatMemberSchema.fields.id),
  planId: EffectSchema.NullOr(chatMemberSchema.fields.id),
  ordinal: countedNumber,
  joinedAt: countedNumber,
});

/** A channel as its row delivers it: its name, plan, and a DM's two members null where it has none, and when it was made. */
const chatChannelLiveRowSchema = EffectSchema.Struct({
  id: chatChannelSchema.fields.id,
  kind: chatChannelSchema.fields.kind,
  name: EffectSchema.NullOr(EffectSchema.String),
  planId: EffectSchema.NullOr(chatChannelSchema.fields.id),
  archived: chatChannelSchema.fields.archived,
  purpose: EffectSchema.NullOr(EffectSchema.String),
  dmAMemberId: EffectSchema.NullOr(chatChannelSchema.fields.id),
  dmBMemberId: EffectSchema.NullOr(chatChannelSchema.fields.id),
  createdAt: countedNumber,
});

/** An ask as its poster stated it, as the message's row holds it. */
const chatAskLiveSchema = EffectSchema.Struct({
  title: EffectSchema.optionalKey(EffectSchema.String),
  response: chatMessageAskSchema.fields.response,
  needsReply: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** A message as its row delivers it: its thread root and ask null where it has none, and the ask's parts as the row holds them. */
const chatMessageLiveRowSchema = EffectSchema.Struct({
  ...chatMessageSchema.fields,
  parentId: EffectSchema.NullOr(chatMessageSchema.fields.id),
  ask: EffectSchema.NullOr(chatAskLiveSchema),
  askKey: EffectSchema.NullOr(EffectSchema.String),
  askRevision: EffectSchema.NullOr(countedNumber),
  askStatus: EffectSchema.NullOr(chatMessageAskSchema.fields.status),
  answer: EffectSchema.NullOr(inboxReplySchema),
  answeredBy: EffectSchema.NullOr(chatMessageSchema.fields.id),
  closedReason: EffectSchema.NullOr(EffectSchema.String),
});

/** A workspace's chat as Realtime delivers its rows, decoded at the boundary before anything reads them. */
export const workspaceChatLiveRowsSchema = EffectSchema.Struct({
  self: EffectSchema.Array(
    EffectSchema.Struct({ self: chatMemberSchema.fields.id, readSeq: countedNumber }),
  ),
  members: EffectSchema.Array(chatMemberLiveRowSchema),
  channels: EffectSchema.Array(chatChannelLiveRowSchema),
  messages: EffectSchema.Array(chatMessageLiveRowSchema),
  reads: EffectSchema.Array(
    EffectSchema.Struct({ channelId: chatChannelSchema.fields.id, readSeq: countedNumber }),
  ),
});

type WorkspaceChatLiveRows = typeof workspaceChatLiveRowsSchema.Type;

/** Two keys compared in order: the first that differs decides. */
function byKeys(...keys: readonly (readonly [number | string, number | string])[]): number {
  for (const [a, b] of keys) if (a !== b) return a < b ? -1 : 1;
  return 0;
}

/** A member as the window reads one, each absent part left out rather than null, as the held read writes it. */
function chatMemberOfLiveRow(row: typeof chatMemberLiveRowSchema.Type): ChatMember {
  return {
    id: row.id,
    kind: row.kind,
    handle: row.handle,
    ...(row.name === null ? undefined : { name: row.name }),
    ...(row.userId === null ? undefined : { userId: row.userId }),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    ...(row.planId === null ? undefined : { planId: row.planId }),
    left: row.left,
  };
}

/** A channel as the window reads one, a DM's two members named, as the held read writes it. */
function chatChannelOfLiveRow(row: typeof chatChannelLiveRowSchema.Type): ChatChannel {
  const { dmAMemberId, dmBMemberId } = row;
  return {
    id: row.id,
    kind: row.kind,
    ...(row.name === null ? undefined : { name: row.name }),
    ...(row.planId === null ? undefined : { planId: row.planId }),
    ...(dmAMemberId === null || dmBMemberId === null
      ? undefined
      : { members: [dmAMemberId, dmBMemberId] }),
    archived: row.archived,
    ...(row.purpose === null ? undefined : { purpose: row.purpose }),
  };
}

/** The ask a message's row carries, as the window reads it; nothing where it carries none. */
function chatAskOfLiveRow(
  row: typeof chatMessageLiveRowSchema.Type,
): Pick<ChatMessage, "ask"> | undefined {
  const { ask, askKey, askRevision, askStatus } = row;
  if (ask === null || askKey === null || askRevision === null || askStatus === null) {
    return undefined;
  }
  return {
    ask: {
      key: askKey,
      revision: askRevision,
      status: askStatus,
      ...(ask.title === undefined ? undefined : { title: ask.title }),
      response: ask.response,
      needsReply: ask.needsReply ?? true,
      ...(row.answer === null ? undefined : { answer: row.answer }),
      ...(row.answeredBy === null ? undefined : { answeredBy: row.answeredBy }),
      ...(row.closedReason === null ? undefined : { closedReason: row.closedReason }),
    },
  };
}

/** A message as the window reads one, as the held read writes it. */
function chatMessageOfLiveRow(row: typeof chatMessageLiveRowSchema.Type): ChatMessage {
  return {
    id: row.id,
    seq: row.seq,
    touchedSeq: row.touchedSeq,
    channelId: row.channelId,
    ...(row.parentId === null ? undefined : { parentId: row.parentId }),
    authorId: row.authorId,
    blocks: row.blocks,
    mentions: row.mentions,
    postedAt: row.postedAt,
    ...chatAskOfLiveRow(row),
  };
}

/**
 * The workspace's chat as the held read answers it from the start, built
 * from the live rows: the roster in the order its members joined, the
 * channels in the order they were made, the messages the rows hold (each
 * channel's newest) in the order they last changed, and each channel read past the reader's floor.
 * The cursor is the held read's alone, so a live answer carries none.
 * Nothing where the reader's own member is not among the rows: the account
 * left the workspace or turned Chat off.
 */
export function workspaceChatOfLiveRows(rows: WorkspaceChatLiveRows): ChatAnswer | undefined {
  const [self] = rows.self;
  if (self === undefined) return undefined;
  const reads = rows.reads
    .filter((read) => read.readSeq > self.readSeq)
    .toSorted((a, b) => byKeys([a.channelId, b.channelId]));
  return {
    self: self.self,
    readSeq: self.readSeq,
    ...(reads.length === 0 ? undefined : { reads }),
    members: rows.members
      .toSorted((a, b) =>
        byKeys([a.joinedAt, b.joinedAt], [a.kind, b.kind], [a.ordinal, b.ordinal]),
      )
      .map(chatMemberOfLiveRow),
    channels: rows.channels
      .toSorted((a, b) => byKeys([a.createdAt, b.createdAt], [a.id, b.id]))
      .map(chatChannelOfLiveRow),
    messages: rows.messages
      .toSorted((a, b) => a.touchedSeq - b.touchedSeq)
      .map(chatMessageOfLiveRow),
    cursor: "",
  };
}
