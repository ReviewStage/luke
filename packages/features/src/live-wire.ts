import { Schema as EffectSchema } from "effect";
import {
  type AccountFailedRun,
  type AccountInboxAnswer,
  accountFailedRunSchema,
  accountInboxAgentSchema,
  accountInboxAutomationSchema,
  accountInboxEntrySchema,
  accountInboxTaskSchema,
  accountTasklessEntrySchema,
} from "./account-inbox-wire.js";
import {
  type AgentBrowserTab,
  agentBrowserTabLineSchema,
  agentBrowserTabOf,
} from "./agent-browser-tab-wire.js";
import { agentMessagesAnswerSchema } from "./agent-wire.js";
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
  standingAsk,
} from "./inbox-wire.js";
import { type MacCommand, macCommandSchema } from "./mac-command-wire.js";
import { type PageLine, pageLineSchema, pageShowerSchema } from "./page-wire.js";
import { countedNumber } from "./service-wire.js";
import {
  DESCRIPTION_ACTOR,
  DESCRIPTION_HISTORY_BOUNDS,
  type DescriptionRevisionLine,
  type DescriptionRevisionsAnswer,
  descriptionRevisionSeqSchema,
  UNKNOWN_AGENT_LABEL,
} from "./task-wire.js";
import { transcriptWindowPartRowSchema, transcriptWindowRowSchema } from "./transcript-window.js";

export const LIVE_POLL_URL = "vespin-poll:";

export const LIVE_POLL = {
  QUERY: "poll",
  ON: "true",
  AFTER: "after",
  CURSOR: "cursor",
  SYNC: "sync",
} as const;

export const LIVE_USER_QUERY = "userId";

export const LIVE_SIGNED_OUT = { failure: "signed-out" } as const;

const LIVE_SOCKET_PATH = "/api/live/socket";

export const LIVE_SOCKET = {
  PATH: LIVE_SOCKET_PATH,
  READ_PREFIX: LIVE_SOCKET_PATH.slice(0, LIVE_SOCKET_PATH.lastIndexOf("/") + 1),
} as const;

const LIVE_SOCKET_PATH_MAX_CHARS = 8 * 1024;

const PATH_BASE = "http://live.invalid";

function isLiveReadPath(path: string): boolean {
  if (!path.startsWith(LIVE_SOCKET.READ_PREFIX) || !URL.canParse(path, PATH_BASE)) return false;
  return new URL(path, PATH_BASE).pathname.startsWith(LIVE_SOCKET.READ_PREFIX);
}

const liveSocketAskIdSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0));

export const liveSocketAskSchema = EffectSchema.Struct({
  id: liveSocketAskIdSchema,
  path: EffectSchema.String.check(
    EffectSchema.isMaxLength(LIVE_SOCKET_PATH_MAX_CHARS),
    EffectSchema.makeFilter(isLiveReadPath),
  ),
});

export type LiveSocketAsk = typeof liveSocketAskSchema.Type;

export const liveSocketAnswerSchema = EffectSchema.Struct({
  id: liveSocketAskIdSchema,
  status: EffectSchema.Int,
  body: EffectSchema.String,
});

export type LiveSocketAnswer = typeof liveSocketAnswerSchema.Type;

export function liveDigestOf(
  queries: Readonly<Record<string, { readonly digest?: string; readonly cursor?: unknown }>>,
): string | undefined {
  const parts = Object.keys(queries)
    .filter((part) => queries[part]?.cursor === undefined)
    .toSorted();
  const digests = parts.map((part) => queries[part]?.digest);
  return digests.every((digest) => digest !== undefined) ? digests.join(",") : undefined;
}

const liveCursorAnswerSchema = EffectSchema.Struct({
  past: EffectSchema.optionalKey(EffectSchema.String),
  next: EffectSchema.String,
});

const liveSyncAnswerSchema = EffectSchema.Struct({
  past: EffectSchema.optionalKey(EffectSchema.String),
  next: EffectSchema.String,
});

export const sealedLiveQuerySchema = EffectSchema.Struct({
  capability: EffectSchema.String,
  queryFingerprint: EffectSchema.String,
  expiresAt: countedNumber,
  rows: EffectSchema.optionalKey(
    EffectSchema.fromJsonString(EffectSchema.Array(EffectSchema.Unknown)),
  ),
  digest: EffectSchema.optionalKey(EffectSchema.String),
  txids: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  snapshot: EffectSchema.optionalKey(EffectSchema.String),
  cursor: EffectSchema.optionalKey(liveCursorAnswerSchema),
  sync: EffectSchema.optionalKey(liveSyncAnswerSchema),
  gone: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
});

export type SealedLiveQueryWire = typeof sealedLiveQuerySchema.Type;

export const accountInboxLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    items: sealedLiveQuerySchema,
    planless: sealedLiveQuerySchema,
    plans: sealedLiveQuerySchema,
    automations: sealedLiveQuerySchema,
    agents: EffectSchema.optionalKey(sealedLiveQuerySchema),
    failedRuns: sealedLiveQuerySchema,
  }),
});

export type AccountInboxLiveAnswer = typeof accountInboxLiveAnswerSchema.Type;

const tasklessLiveRowSchema = EffectSchema.Struct({
  ...accountTasklessEntrySchema.fields,
  workspaceId: EffectSchema.NullOr(EffectSchema.String),
});

const agentHoldingLiveRowSchema = EffectSchema.Struct({
  ...accountInboxAgentSchema.fields,
  workspaceId: EffectSchema.NullOr(EffectSchema.String),
});

export const accountInboxLiveRowSchemas = {
  items: accountInboxEntrySchema,
  planless: tasklessLiveRowSchema,
  plans: accountInboxTaskSchema,
  automations: accountInboxAutomationSchema,
  agents: agentHoldingLiveRowSchema,
  failedRuns: accountFailedRunSchema,
} as const;

export const accountInboxLiveRowsSchema = EffectSchema.Struct({
  items: EffectSchema.Array(accountInboxLiveRowSchemas.items),
  planless: EffectSchema.Array(accountInboxLiveRowSchemas.planless),
  plans: EffectSchema.Array(accountInboxLiveRowSchemas.plans),
  automations: EffectSchema.Array(accountInboxLiveRowSchemas.automations),
  agents: EffectSchema.optionalKey(EffectSchema.Array(accountInboxLiveRowSchemas.agents)),
  failedRuns: EffectSchema.Array(accountInboxLiveRowSchemas.failedRuns),
});

export type AccountInboxLiveRows = typeof accountInboxLiveRowsSchema.Type;

export const FAILED_RUN_WINDOW_MILLIS = 7 * 24 * 60 * 60 * 1000;

function latestFirst<Row extends { readonly updatedAt: number }>(
  key: (row: Row) => string,
): (a: Row, b: Row) => number {
  return (a, b) => {
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    const [left, right] = [key(a), key(b)];
    return left < right ? 1 : left > right ? -1 : 0;
  };
}

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

function liveCursorOf(answer: Omit<AccountInboxAnswer, "cursor" | "readAt">): string {
  const itemStamp = (item: {
    readonly id: string;
    readonly revision: number;
    readonly updatedAt: number;
    readonly unread?: boolean | undefined;
    readonly waitsOn?: string | undefined;
    readonly asking?: boolean | undefined;
    readonly remindAt?: number | null | undefined;
  }) => [
    item.id,
    item.revision,
    item.updatedAt,
    item.unread ?? null,
    item.waitsOn ?? null,
    item.asking ?? null,
    item.remindAt ?? null,
  ];
  return digest(
    JSON.stringify([
      answer.items.map(itemStamp),
      (answer.planless ?? []).map(itemStamp),
      (answer.failedRuns ?? []).map((run) => [run.id, run.failedAt]),
    ]),
  );
}

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
    ...(rows.agents === undefined
      ? undefined
      : {
          agents: rows.agents
            .map(({ workspaceId, ...agent }) =>
              workspaceId === null ? agent : { ...agent, workspaceId },
            )
            .toSorted(latestFirst((agent) => agent.agentId)),
        }),
    failedRuns: rows.failedRuns
      .filter((run) => run.failedAt >= now - FAILED_RUN_WINDOW_MILLIS)
      .toSorted((a, b) => b.failedAt - a.failedAt),
  };
  return { ...answer, cursor: liveCursorOf(answer), readAt: now };
}

export function nextFailedRunExpiry(
  failedRuns: readonly AccountFailedRun[],
  now: number,
): number | undefined {
  const expiries = failedRuns
    .map((run) => run.failedAt + FAILED_RUN_WINDOW_MILLIS)
    .filter((expiry) => expiry > now);
  return expiries.length === 0 ? undefined : Math.min(...expiries);
}

export const taskRecordLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    description: sealedLiveQuerySchema,
    pages: sealedLiveQuerySchema,
    calls: sealedLiveQuerySchema,
    code: sealedLiveQuerySchema,
  }),
});

export type TaskRecordLiveAnswer = typeof taskRecordLiveAnswerSchema.Type;

const taskDescriptionLiveRowSchema = EffectSchema.Struct({
  taskId: EffectSchema.String,
  savedAt: EffectSchema.Finite,
});

const taskPageLiveRowSchema = EffectSchema.Struct({
  pageId: EffectSchema.String,
  version: EffectSchema.Finite,
});

const taskCodeLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  calls: EffectSchema.String,
});

export const taskRecordLiveRowsSchema = EffectSchema.Struct({
  description: EffectSchema.Array(taskDescriptionLiveRowSchema),
  pages: EffectSchema.Array(taskPageLiveRowSchema),
  code: EffectSchema.Array(taskCodeLiveRowSchema),
});

export type TaskRecordLiveRows = typeof taskRecordLiveRowsSchema.Type;

export const agentTranscriptLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    messages: sealedLiveQuerySchema,
    turns: sealedLiveQuerySchema,
    conversation: sealedLiveQuerySchema,
    agent: sealedLiveQuerySchema,
    workers: sealedLiveQuerySchema,
    window: sealedLiveQuerySchema,
    windowParts: sealedLiveQuerySchema,
    queueRevision: EffectSchema.optionalKey(sealedLiveQuerySchema),
    launch: EffectSchema.optionalKey(sealedLiveQuerySchema),
  }),
});

export type AgentTranscriptLiveAnswer = typeof agentTranscriptLiveAnswerSchema.Type;

export const agentTranscriptLiveRowsSchema = EffectSchema.Struct({
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
  window: EffectSchema.Array(transcriptWindowRowSchema),
  windowParts: EffectSchema.Array(transcriptWindowPartRowSchema),
  queueRevision: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.Struct({ revision: countedNumber })),
  ),
  launch: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({
        id: EffectSchema.String,
        step: EffectSchema.NullOr(EffectSchema.String),
        claimed: EffectSchema.Boolean,
        settled: EffectSchema.Boolean,
      }),
    ),
  ),
});

export const TRANSCRIPT_NOW_QUERY = { WAIT: "wait", NONE: "none" } as const;

export const transcriptNowAnswerSchema = EffectSchema.Struct({
  ...agentMessagesAnswerSchema.fields,
  holds: EffectSchema.Boolean,
  wakeIn: EffectSchema.optionalKey(countedNumber),
});

export type TranscriptNowAnswer = typeof transcriptNowAnswerSchema.Type;

export const macCommandsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ commands: sealedLiveQuerySchema }),
});

export type MacCommandsLiveAnswer = typeof macCommandsLiveAnswerSchema.Type;

const [macShellCommandSchema] = macCommandSchema.members;

const macCommandLiveRowSchema = EffectSchema.Struct({
  ...macShellCommandSchema.fields,
  queuedAt: countedNumber,
});

export const macCommandsLiveRowsSchema = EffectSchema.Struct({
  commands: EffectSchema.Array(macCommandLiveRowSchema),
});

export function macCommandsOfLiveRows(
  rows: typeof macCommandsLiveRowsSchema.Type,
): readonly MacCommand[] {
  return rows.commands
    .toSorted((a, b) =>
      a.queuedAt !== b.queuedAt ? a.queuedAt - b.queuedAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )
    .map(
      (row): MacCommand => ({
        id: row.id,
        kind: row.kind,
        command: row.command,
        timeoutSeconds: row.timeoutSeconds,
      }),
    );
}

export const scopeInboxLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    items: sealedLiveQuerySchema,
    messages: sealedLiveQuerySchema,
    files: sealedLiveQuerySchema,
  }),
});

export type ScopeInboxLiveAnswer = typeof scopeInboxLiveAnswerSchema.Type;

const inboxLiveMessageSchema = EffectSchema.Struct({
  id: inboxMessageSchema.fields.id,
  itemId: EffectSchema.String,
  author: inboxMessageSchema.fields.author,
  userId: EffectSchema.NullOr(EffectSchema.String),
  name: EffectSchema.NullOr(EffectSchema.String),
  text: EffectSchema.String,
  ask: EffectSchema.NullOr(inboxReadAskSchema),
  answers: EffectSchema.NullOr(inboxAnswersSchema),
  clientKey: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  createdAt: countedNumber,
});

const inboxLiveFileSchema = EffectSchema.Struct({
  ...inboxAnswerFileSchema.fields,
  messageId: EffectSchema.NullOr(EffectSchema.String),
  position: EffectSchema.NullOr(countedNumber),
});

const { snoozedUntil: _beforeRemindAt, ...liveItemFields } = inboxItemSchema.fields;

const inboxLiveRowSchema = EffectSchema.Struct({
  ...liveItemFields,
  startedBy: EffectSchema.String,
  startedByName: EffectSchema.NullOr(EffectSchema.String),
  waitsOn: EffectSchema.optionalKey(EffectSchema.String),
  waitsOnName: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  answeredBy: EffectSchema.NullOr(EffectSchema.String),
  answeredByName: EffectSchema.NullOr(EffectSchema.String),
  closedReason: EffectSchema.NullOr(EffectSchema.String),
  closedBy: EffectSchema.NullOr(EffectSchema.String),
  closedByName: EffectSchema.NullOr(EffectSchema.String),
  openAskMessageId: EffectSchema.NullOr(EffectSchema.String),
  settledAt: EffectSchema.NullOr(countedNumber),
  unread: EffectSchema.Boolean,
  remindAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
});

export const scopeInboxLiveRowsSchema = EffectSchema.Struct({
  items: EffectSchema.Array(inboxLiveRowSchema),
  messages: EffectSchema.Array(inboxLiveMessageSchema),
  files: EffectSchema.Array(inboxLiveFileSchema),
});

type InboxLiveRows = typeof scopeInboxLiveRowsSchema.Type;
type InboxLiveRow = typeof inboxLiveRowSchema.Type;
type InboxLiveMessage = typeof inboxLiveMessageSchema.Type;
type InboxLiveFile = typeof inboxLiveFileSchema.Type;

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

function filesInOrder(files: readonly InboxLiveFile[] | undefined) {
  return (files ?? [])
    .toSorted((one, other) => (one.position ?? Infinity) - (other.position ?? Infinity))
    .map(({ attachmentId, name, mediaType }) => ({ attachmentId, name, mediaType }));
}

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
    ...(row.clientKey === undefined || row.clientKey === null
      ? undefined
      : { clientKey: row.clientKey }),
    createdAt: row.createdAt,
  };
}

function threadOf(
  messages: readonly InboxLiveMessage[],
  openAskMessageId: string | null,
): readonly InboxLiveMessage[] {
  const ordered = messages.toSorted(threadOrder);
  const latest = new Set(ordered.slice(-INBOX_BOUNDS.MAX_MESSAGES_READ).map((each) => each.id));
  const firstId = ordered[0]?.id;
  return ordered.filter(
    (each) => latest.has(each.id) || each.id === firstId || each.id === openAskMessageId,
  );
}

function threadOrder(one: InboxLiveMessage, other: InboxLiveMessage): number {
  if (one.createdAt !== other.createdAt) return one.createdAt - other.createdAt;
  return one.id < other.id ? -1 : one.id > other.id ? 1 : 0;
}

function inboxItemOfLiveRow(
  row: InboxLiveRow,
  threads: ReadonlyMap<string, readonly InboxLiveMessage[]>,
  messageFilesOf: ReadonlyMap<string, readonly InboxLiveFile[]>,
): InboxItem {
  const {
    startedBy,
    startedByName,
    waitsOn,
    waitsOnName,
    answeredBy,
    answeredByName,
    closedReason,
    closedBy,
    closedByName,
    openAskMessageId,
    settledAt,
    markedUnread,
    remindAt,
    ...item
  } = row;
  const thread = threadOf(threads.get(row.id) ?? [], openAskMessageId);
  const message = (each: InboxLiveMessage) =>
    inboxMessageOfLiveRow(each, messageFilesOf, {
      status: row.status,
      openAskMessageId,
      closedReason,
    });
  return {
    ...item,
    ...(startedByName === null
      ? undefined
      : { startedBy: { userId: startedBy, name: startedByName } }),
    ...(waitsOn === undefined || waitsOnName === undefined || waitsOnName === null
      ? undefined
      : { waitsOn: { userId: waitsOn, name: waitsOnName } }),
    ...(answeredBy === null || answeredByName === null
      ? undefined
      : { answeredBy: { userId: answeredBy, name: answeredByName } }),
    ...(closedReason === null ? undefined : { closedReason }),
    ...(closedBy === null || closedByName === null
      ? undefined
      : { closedBy: { userId: closedBy, name: closedByName } }),
    ...(thread.length === 0 ? undefined : { thread: thread.map(message) }),
    ...(settledAt === null ? undefined : { settledAt }),
    ...(markedUnread === true ? { markedUnread } : undefined),
    ...(remindAt === undefined || remindAt === null ? undefined : { remindAt }),
  };
}

export function inboxInOrder(items: readonly InboxItem[]): readonly InboxItem[] {
  const ordered = latestFirst((item: InboxItem) => item.id);
  return [
    ...items.filter((item) => item.status === INBOX_STATUS.OPEN).toSorted(ordered),
    ...items.filter((item) => item.status !== INBOX_STATUS.OPEN).toSorted(ordered),
  ];
}

export function inboxOfLiveRows(rows: InboxLiveRows): readonly InboxItem[] {
  const threads = groupedBy(rows.messages, (message) => message.itemId);
  const messageFilesOf = groupedBy(rows.files, (file) => file.messageId);
  return inboxInOrder(rows.items.map((row) => inboxItemOfLiveRow(row, threads, messageFilesOf)));
}

export const LIVE_READ = {
  ACCOUNT_PREFERENCES: "accountPreferences",
  AGENT_ORIGINS: "agentOrigins",
  INBOX_ITEMS: "inboxItems",
  HOLDER_INBOX: "holderInbox",
  INSTALLED_SKILLS: "installedSkills",
  INTEGRATIONS: "integrationStatuses",
  INTEGRATION_TOOLS: "integrationTools",
  LINK_STANDINGS: "linkStandings",
  MEMORIES: "workspaceMemories",
  MODELS: "models",
  PAGES: "pages",
  PROVIDER_KEYS: "providerKeys",
  PULL_REQUEST: "pullRequest",
  GITHUB_TOKEN: "githubToken",
  PULL_REQUEST_CHAPTERS: "pullRequestChapters",
  PULL_REQUEST_CHECKS: "pullRequestChecks",
  PULL_REQUEST_CONVERSATION: "pullRequestConversation",
  PULL_REQUEST_PUBLISHED: "pullRequestPublished",
  PULL_REQUEST_VIEWED: "pullRequestViewed",
  REVIEW_OPTIONS: "reviewOptions",
  DESCRIPTION_COMMENTS: "taskComments",
  HISTORY: "taskHistory",
  BROWSER_TABS: "browserTabs",
  REPOSITORY_LISTS: "repositoryLists",
  DEVICE_PRESENCE: "devicePresence",
  HOSTS: "hosts",
  WORKSPACE_INVITATIONS: "workspaceInvitations",
  THIS_MAC_HOST: "thisMacHost",
  TRANSCRIPT: "transcripts",
  WORKSPACE_MEMBERS: "workspaceMembers",
  WORKSPACE_INTEGRATIONS: "workspaceIntegrations",
  SLACK_CHANNELS: "slackChannels",
  TOKEN_REPOSITORIES: "tokenRepositories",
  WORKSPACE_PHOTOS: "workspacePhotos",
  WORKSPACE_TOOLS: "workspaceTools",
  MCP_CLIENTS: "mcpClients",
  AUTOMATIONS: "automations",
  AUTOMATION_WORKSPACE_RUNS: "automationWorkspaceRuns",
  AUTOMATION_RUNS: "automationRuns",
  DESCRIPTION_DOCUMENT: "descriptionDocument",
} as const;

export type LiveRead = (typeof LIVE_READ)[keyof typeof LIVE_READ];

export const ACCOUNT_INBOX_ITEMS = {
  SINCE: "since",
  HELD_ON: ["stamps"],
  SETTLED_WINDOW_MILLIS: 30 * 24 * 60 * 60 * 1000,
} as const;

export function liveDigestOn(
  queries: Readonly<Record<string, { readonly digest?: string; readonly cursor?: unknown }>>,
  parts: readonly string[],
): string | undefined {
  return liveDigestOf(Object.fromEntries(parts.map((part) => [part, queries[part] ?? {}])));
}

export const accountInboxItemsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    stamps: sealedLiveQuerySchema,
    items: sealedLiveQuerySchema,
    messages: sealedLiveQuerySchema,
    files: sealedLiveQuerySchema,
  }),
});

export type AccountInboxItemsLiveAnswer = typeof accountInboxItemsLiveAnswerSchema.Type;

const inboxItemStampRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  planId: EffectSchema.NullOr(EffectSchema.String),
  agentId: EffectSchema.String,
  revision: countedNumber,
  version: countedNumber,
  status: inboxItemSchema.fields.status,
  updatedAt: countedNumber,
  unread: EffectSchema.Boolean,
  remindAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  waitsOn: EffectSchema.String,
  messages: countedNumber,
});

export const accountInboxItemsLiveRowsSchema = EffectSchema.Struct({
  stamps: EffectSchema.Array(inboxItemStampRowSchema),
  ...scopeInboxLiveRowsSchema.fields,
});

export type AccountInboxItemsLiveRows = typeof accountInboxItemsLiveRowsSchema.Type;

export type InboxItemStamp = AccountInboxItemsLiveRows["stamps"][number];

function byKeys(...keys: readonly (readonly [number | string, number | string])[]): number {
  for (const [a, b] of keys) if (a !== b) return a < b ? -1 : 1;
  return 0;
}

export const taskPagesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ pages: sealedLiveQuerySchema }),
});

export type TaskPagesLiveAnswer = typeof taskPagesLiveAnswerSchema.Type;

const taskPagesLiveRowSchema = EffectSchema.Struct({
  id: pageLineSchema.fields.id,
  title: pageLineSchema.fields.title,
  version: pageLineSchema.fields.version,
  at: pageLineSchema.fields.at,
  shownBy: EffectSchema.NullOr(pageShowerSchema),
});

export const taskPagesLiveRowsSchema = EffectSchema.Struct({
  pages: EffectSchema.Array(taskPagesLiveRowSchema),
});

export function pagesOfLiveRows(rows: typeof taskPagesLiveRowsSchema.Type): readonly PageLine[] {
  return rows.pages
    .map(({ shownBy, ...line }): PageLine => (shownBy === null ? line : { ...line, shownBy }))
    .toSorted((one, other) =>
      one.at !== other.at ? other.at - one.at : one.id < other.id ? -1 : one.id > other.id ? 1 : 0,
    );
}

export const taskBrowserTabsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ tabs: sealedLiveQuerySchema }),
});

export type TaskBrowserTabsLiveAnswer = typeof taskBrowserTabsLiveAnswerSchema.Type;

export const taskBrowserTabsLiveRowsSchema = EffectSchema.Struct({
  tabs: EffectSchema.Array(agentBrowserTabLineSchema),
});

export function browserTabsOfLiveRows(
  rows: typeof taskBrowserTabsLiveRowsSchema.Type,
  now: number,
): readonly AgentBrowserTab[] {
  return rows.tabs
    .toSorted((one, other) => byKeys([one.createdAt, other.createdAt], [one.id, other.id]))
    .map((line) => agentBrowserTabOf(line, now));
}

export function nextBrowserTabLapse(
  rows: typeof taskBrowserTabsLiveRowsSchema.Type,
  now: number,
): number | undefined {
  const lapses = rows.tabs.flatMap(({ driverUserId, heldUntil }) =>
    driverUserId !== null && heldUntil !== null && heldUntil > now ? [heldUntil] : [],
  );
  return lapses.length === 0 ? undefined : Math.min(...lapses);
}

export const taskHistoryLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ revisions: sealedLiveQuerySchema }),
});

export type TaskHistoryLiveAnswer = typeof taskHistoryLiveAnswerSchema.Type;

const taskHistoryLiveRowSchema = EffectSchema.Struct({
  seq: descriptionRevisionSeqSchema,
  actor: EffectSchema.Literals(Object.values(DESCRIPTION_ACTOR)),
  editorId: EffectSchema.NullOr(EffectSchema.String),
  editorName: EffectSchema.NullOr(EffectSchema.String),
  agentId: EffectSchema.NullOr(EffectSchema.String),
  agentModel: EffectSchema.NullOr(EffectSchema.String),
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  changes: countedNumber,
  restoredFrom: EffectSchema.NullOr(descriptionRevisionSeqSchema),
  at: countedNumber,
  startedAt: countedNumber,
  restoredAt: EffectSchema.NullOr(countedNumber),
});

export const taskHistoryLiveRowsSchema = EffectSchema.Struct({
  revisions: EffectSchema.Array(taskHistoryLiveRowSchema),
});

type TaskHistoryLiveRow = typeof taskHistoryLiveRowSchema.Type;

function revisionLineOf(row: TaskHistoryLiveRow): DescriptionRevisionLine {
  return {
    seq: row.seq,
    lastEdit: {
      actor: row.actor,
      ...(row.editorId === null || row.editorName === null
        ? undefined
        : { by: { userId: row.editorId, name: row.editorName } }),
      ...(row.actor === DESCRIPTION_ACTOR.AGENT
        ? { label: row.agentTitle ?? row.agentModel ?? UNKNOWN_AGENT_LABEL }
        : undefined),
      ...(row.agentId === null ? undefined : { agentId: row.agentId }),
      at: row.at,
      duringCall: false,
    },
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    startedAt: row.startedAt,
    changes: row.changes,
    ...(row.restoredFrom === null || row.restoredAt === null
      ? undefined
      : { restoredFrom: { seq: row.restoredFrom, at: row.restoredAt } }),
  };
}

export function revisionsOfLiveRows(
  rows: typeof taskHistoryLiveRowsSchema.Type,
): DescriptionRevisionsAnswer {
  const newest = rows.revisions.toSorted((one, other) => other.seq - one.seq);
  const page = newest.slice(0, DESCRIPTION_HISTORY_BOUNDS.PAGE);
  const revisions = page.map(revisionLineOf);
  const oldest = page.at(-1);
  return newest.length > page.length && oldest !== undefined
    ? { revisions, earlier: oldest.seq }
    : { revisions };
}
