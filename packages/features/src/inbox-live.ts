/**
 * inbox-live.ts -- the inbox reads the desktop follows over Neon Realtime, each declared once (`live-read.ts`): what waits on the developer across the account, one plan's or one agent's inbox, and every item the account reaches; and the answers the held reads give, built from their rows.
 */

import { Schema as EffectSchema } from "effect";
import {
  ACCOUNT_INBOX_REPOSITORYLESS,
  type AccountFailedRun,
  type AccountInboxAnswer,
  accountFailedRunSchema,
  accountInboxAgentSchema,
  accountInboxAutomationSchema,
  accountInboxEntrySchema,
  accountInboxTaskSchema,
  accountTasklessEntrySchema,
} from "./account-inbox-wire.js";
import { refuses } from "./contract/base.js";
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
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { ACCOUNT_INBOX_ITEMS, LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

/** An item of an agent with no plan as its row delivers it: the workspace as the column holds it, null for none. */
const tasklessLiveRowSchema = EffectSchema.Struct({
  ...accountTasklessEntrySchema.fields,
  workspaceId: EffectSchema.NullOr(EffectSchema.String),
});

/** An agent with no plan holding items as its row delivers it: the workspace as the column holds it, null for none. */
const agentHoldingLiveRowSchema = EffectSchema.Struct({
  ...accountInboxAgentSchema.fields,
  workspaceId: EffectSchema.NullOr(EffectSchema.String),
});

/** The latest changed first, and by the key among those changed at one instant, as the held read orders a part's rows. */
function latestOrder<Key extends string>(key: Key) {
  return [
    ["updatedAt", ORDER.DESC],
    [key, ORDER.DESC],
  ] as const;
}

/**
 * What waits on the developer across the account, as one live read
 * declares it, by the account (`inbox`): one part per part of the account
 * inbox's answer (`account-inbox-wire.ts`), the items of agents with no
 * repository among them only where the reader asks
 * (`ACCOUNT_INBOX_REPOSITORYLESS`). A released desktop (v0.22.0) keeps
 * every part but `agents`, whose decode strips it, so it sends the digest
 * over those (`olderParts`). The service answers `unavailable` where its
 * deployment's Realtime is misconfigured, which the desktop answers by
 * asking again.
 */
export const ACCOUNT_INBOX_READ = liveRead({
  name: "inbox",
  path: HOSTED_SERVICE_PATH.LIVE_INBOX,
  params: {
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
    [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: LIVE_PARAM.OPTIONAL_TEXT,
  },
  query: {
    [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: EffectSchema.optionalKey(
      EffectSchema.Literal(ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE),
    ),
  },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    items: liveRows({ row: accountInboxEntrySchema, key: "id", order: latestOrder("id") }),
    planless: liveRows({ row: tasklessLiveRowSchema, key: "id", order: latestOrder("id") }),
    plans: liveRows({ row: accountInboxTaskSchema, key: "planId", order: latestOrder("planId") }),
    automations: liveRows({
      row: accountInboxAutomationSchema,
      key: "automationId",
      order: latestOrder("automationId"),
    }),
    /** Each agent with no task holding items; absent from a service before it, as the held read's `agents` is. */
    agents: liveRows({
      row: agentHoldingLiveRowSchema,
      key: "agentId",
      order: latestOrder("agentId"),
      optional: true,
    }),
    failedRuns: liveRows({
      row: accountFailedRunSchema,
      key: "id",
      order: [["failedAt", ORDER.DESC]],
    }),
  },
  olderParts: ["items", "planless", "plans", "automations", "failedRuns"],
});

export type AccountInboxLiveAnswer = LiveReadAnswer<typeof ACCOUNT_INBOX_READ>;

/** Each part's rows, decoded. */
export type AccountInboxLiveRows = typeof ACCOUNT_INBOX_READ.rows.Type;

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
 * stamps, each item's id, revision, instant, read state, who it waits
 * on, so its task's assignee changing moves it, whether it asks, and until
 * when its reminder comes due, and
 * each failed run, so an answer whose cursor is the last one's moved nothing
 * a reader announces or counts, as a held answer's does.
 */
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

/**
 * When the earliest failed run the rows carry at `now` ages out of the last
 * week, in epoch milliseconds; none where they carry none. Nothing a live
 * statement delivers says so, since Realtime follows no clock, so the
 * follower builds the answer again then.
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

/** One message of an item's thread as its row carries it: its item, the member by id and name, either null where none stands, and the key the reader's own was sent under. */
const inboxLiveMessageSchema = EffectSchema.Struct({
  id: inboxMessageSchema.fields.id,
  itemId: EffectSchema.String,
  author: inboxMessageSchema.fields.author,
  userId: EffectSchema.NullOr(EffectSchema.String),
  name: EffectSchema.NullOr(EffectSchema.String),
  text: EffectSchema.String,
  ask: EffectSchema.NullOr(inboxReadAskSchema),
  answers: EffectSchema.NullOr(inboxAnswersSchema),
  /** The key the reader's own message was sent under; null on every other, and absent from a service before it. */
  clientKey: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  createdAt: countedNumber,
});

/** One file as its row carries it: the message that carried it, and where it stands among its files. */
const inboxLiveFileSchema = EffectSchema.Struct({
  ...inboxAnswerFileSchema.fields,
  messageId: EffectSchema.NullOr(EffectSchema.String),
  position: EffectSchema.NullOr(countedNumber),
});

/** An item's fields bar the key a hosted answer still fills for a desktop from before the rename, which a live row carries for that desktop alone. */
const {
  snoozedUntil: _beforeRemindAt,
  thread: _thread,
  ...liveItemFields
} = inboxItemSchema.fields;

/** One item as its row delivers it: what an item leaves out where it holds nothing is null. */
const inboxLiveRowSchema = EffectSchema.Struct({
  ...liveItemFields,
  startedBy: EffectSchema.String,
  startedByName: EffectSchema.NullOr(EffectSchema.String),
  /** Absent from a service before it, as the item's own `waitsOn` is. */
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
  /** Null where the reader set no reminder on the item; absent from a service before reminders. */
  remindAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  /** The reminder under its name before the rename, carried for a desktop from before it; this build reads `remindAt`. */
  snoozedUntil: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
});

/** A scope's items, their threads' messages, and their files, as a plan's inbox, an agent's, and the account's items carry them, each by its key. */
export const SCOPE_INBOX_PARTS = {
  items: liveRows({ row: inboxLiveRowSchema, key: "id", order: latestOrder("id") }),
  messages: liveRows({
    row: inboxLiveMessageSchema,
    key: "id",
    order: [
      ["createdAt", ORDER.ASC],
      ["id", ORDER.ASC],
    ],
  }),
  files: liveRows({
    row: inboxLiveFileSchema,
    key: "attachmentId",
    order: [
      ["messageId", ORDER.ASC],
      ["position", ORDER.ASC],
    ],
  }),
} as const;

/**
 * One plan's inbox, named by `?id=` (`taskInbox`): its open items and its
 * latest settled ones as one part, as the held read reads them, so an item
 * settling moves in one change, with their threads' latest messages and
 * the files their answers and messages carried as two more, which the
 * reader joins to them. The service answers `not-found` for a plan the
 * account does not reach, and `unavailable` where its deployment's Realtime
 * is misconfigured, which the desktop answers by asking again.
 */
export const TASK_INBOX_READ = liveRead({
  name: "taskInbox",
  path: HOSTED_SERVICE_PATH.LIVE_TASK_INBOX,
  // Note that the account is named first, so a session of another is refused as signed out before the id is read.
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, id: LIVE_PARAM.ID },
  mode: LIVE_MODE.SNAPSHOT,
  parts: SCOPE_INBOX_PARTS,
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

/** One agent's inbox, named by `?id=` (`agentInbox`), on the terms a plan's is. */
export const AGENT_INBOX_READ = liveRead({
  name: "agentInbox",
  path: HOSTED_SERVICE_PATH.LIVE_AGENT_INBOX,
  // Note that the account is named first, so a session of another is refused as signed out before the id is read.
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, id: LIVE_PARAM.ID },
  mode: LIVE_MODE.SNAPSHOT,
  parts: SCOPE_INBOX_PARTS,
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type ScopeInboxLiveAnswer = LiveReadAnswer<typeof TASK_INBOX_READ>;

/** A scope's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export type ScopeInboxLiveRows = typeof TASK_INBOX_READ.rows.Type;

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
    ...(row.clientKey === undefined || row.clientKey === null
      ? undefined
      : { clientKey: row.clientKey }),
    createdAt: row.createdAt,
  };
}

/**
 * An item's thread from its delivered messages, oldest first, as the held
 * read carries it: its latest `MAX_MESSAGES_READ` messages, with its first
 * and the one whose ask it holds open however many came since.
 */
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

/** A thread's messages oldest first, as the held read orders them. */
function threadOrder(one: InboxLiveMessage, other: InboxLiveMessage): number {
  if (one.createdAt !== other.createdAt) return one.createdAt - other.createdAt;
  return one.id < other.id ? -1 : one.id > other.id ? 1 : 0;
}

/** A row as the wire carries its item, its thread and its files joined to it, each absent field left out rather than null, as the held read writes it. */
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
    snoozedUntil: _snoozedUntil,
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

/** Items as the held read orders a scope's: every open one, then the settled, each the latest changed first. */
export function inboxInOrder(items: readonly InboxItem[]): readonly InboxItem[] {
  const ordered = latestFirst((item: InboxItem) => item.id);
  return [
    ...items.filter((item) => item.status === INBOX_STATUS.OPEN).toSorted(ordered),
    ...items.filter((item) => item.status !== INBOX_STATUS.OPEN).toSorted(ordered),
  ];
}

/** The scope's items as the held read answers them: every open one, then the latest settled, each the latest changed first. */
export function inboxOfLiveRows(rows: ScopeInboxLiveRows): readonly InboxItem[] {
  const threads = groupedBy(rows.messages, (message) => message.itemId);
  const messageFilesOf = groupedBy(rows.files, (file) => file.messageId);
  return inboxInOrder(rows.items.map((row) => inboxItemOfLiveRow(row, threads, messageFilesOf)));
}

/**
 * Where one item stands as its row carries it: its plan, null for an item
 * of an agent with no task, and its agent; its stamp; whether it is unread
 * for the reader, which a read mark moves without moving `updatedAt`; who
 * it waits on; and how many messages its thread holds, which a withdrawn
 * message moves.
 */
const inboxItemStampRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  planId: EffectSchema.NullOr(EffectSchema.String),
  agentId: EffectSchema.String,
  revision: countedNumber,
  version: countedNumber,
  status: inboxItemSchema.fields.status,
  updatedAt: countedNumber,
  unread: EffectSchema.Boolean,
  /** When the reader's reminder on the item comes due, which a reminder moves without moving `updatedAt`; null where they set none, absent from a service before reminders. */
  remindAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  waitsOn: EffectSchema.String,
  messages: countedNumber,
  /** The item's workspace, carried for a desktop from before the inbox's channels were removed, which decodes a stamp without it as no stamp. */
  channelId: EffectSchema.optionalKey(EffectSchema.String),
  /** The reminder under its name before the rename, carried for a desktop from before it; this build reads `remindAt`. */
  snoozedUntil: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
});

/**
 * Every inbox item the account reaches (`inboxItems`): where each item
 * stands (`stamps`), every open item and every settled one changed in the
 * last thirty days, on the account's tasks and of its agents with no task;
 * and the items among them changed since the reader's `since`, whole, with
 * their threads and files, as a plan's inbox carries them. Its poll is held
 * on `stamps` alone (`ACCOUNT_INBOX_ITEMS.HELD_ON`), whose digest the
 * reader sends as `after` (`liveDigestOn`). Past a sync id
 * (`LIVE_POLL.SYNC`), every part carries the items that moved alone, each
 * whole: its stamp, its row, and every message and file its thread draws,
 * which the reader takes in place of what it holds of the item; a part's
 * `gone` names items alone. The settled items it carries are those changed
 * since `settledSince`, which the service binds from its clock.
 */
export const INBOX_ITEMS_READ = liveRead({
  name: LIVE_READ.INBOX_ITEMS,
  path: HOSTED_SERVICE_PATH.LIVE_INBOX_ITEMS,
  params: {
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
    [ACCOUNT_INBOX_ITEMS.SINCE]: LIVE_PARAM.OPTIONAL_TEXT,
    settledSince: LIVE_PARAM.SERVED,
  },
  mode: LIVE_MODE.DELTA,
  parts: {
    stamps: liveRows({ row: inboxItemStampRowSchema, key: "id", order: latestOrder("id") }),
    ...SCOPE_INBOX_PARTS,
  },
  heldOn: ACCOUNT_INBOX_ITEMS.HELD_ON,
});

export type AccountInboxItemsLiveAnswer = LiveReadAnswer<typeof INBOX_ITEMS_READ>;

/** Each part's rows of the account's inbox items, decoded. */
export type AccountInboxItemsLiveRows = typeof INBOX_ITEMS_READ.rows.Type;

/** Where one item stands as its stamp row carries it. */
export type InboxItemStamp = AccountInboxItemsLiveRows["stamps"][number];
