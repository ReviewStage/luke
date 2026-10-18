import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  LIVE_COUNT,
  type LiveStatement,
  liveLatest,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import {
  Database,
  type DatabaseServices,
  type QueryError,
  queryBuilder,
} from "@luke/database/core/query";
import { automationReadableBy } from "@luke/database/models/automation-store";
import {
  type ChatWaitingLiveStatements,
  chatWaitingLiveStatements,
} from "@luke/database/models/chat-store";
import { InstantColumnSchema } from "@luke/database/models/columns";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  taskReachableBy,
  workspaceReachableBy,
} from "@luke/database/models/workspace-store";
import { attachment } from "@luke/database/schemas/attachment";
import { organization, user } from "@luke/database/schemas/auth";
import { automation } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { inboxItem } from "@luke/database/schemas/inbox";
import { inboxItemRead } from "@luke/database/schemas/inbox-item-read";
import { inboxMessage } from "@luke/database/schemas/inbox-message";
import { task } from "@luke/database/schemas/task";
import { INBOX_ATTACHMENT_KIND } from "@luke/database/storage-vocabulary";
import type {
  AccountInboxAutomation,
  AccountInboxEntry,
  AccountInboxTask,
  AccountTasklessEntry,
} from "@luke/features/account-inbox-wire";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
  type CodingAgentAttachmentType,
} from "@luke/features/coding-agent-wire";
import { type InboxItemPlace, inboxAttachmentAddress } from "@luke/features/inbox-attachment-link";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxAnswers,
  type InboxAsk,
  type InboxBlock,
  type InboxImageType,
  type InboxItem,
  type InboxMessage,
  type InboxPost,
  type InboxPostBlock,
  type InboxReadAsk,
  type InboxReply,
  type InboxResponse,
  inboxAnswersRefusal,
  inboxAnswersSchema,
  inboxAskResponse,
  inboxAskSchema,
  inboxBlockSchema,
  inboxReadAskSchema,
  inboxReplyAnswers,
  inboxReplySchema,
  inboxResponseAsk,
  inboxResponseSchema,
} from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { insideCode } from "@luke/features/mention-link";
import { taskPictureMarkdown } from "@luke/features/plan-attachment-link";
import {
  and,
  count,
  desc,
  eq,
  getTableName,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/**
 * inbox-store.ts -- the developer's inbox: the items a task's coding agents post, close, and read as threads of messages with asks, and the developer's answers to them.
 *
 * Every statement names the account beside the task, the agent, or the
 * item. An item is its agent's, written under the member who started the
 * agent, and the task's inbox is the workspace's: every member of the
 * task's workspace reads and answers it, gated on that membership
 * (`workspace-store.ts`), so an item of a workspace the account is not in
 * reads and writes exactly as one that names nothing. An agent posts an item under a key of its own, which is
 * one row per agent and key: posting under a key it used before writes
 * that row again, moves its revision on, and opens it again whether it was
 * answered or closed, so the agent keeps an item current rather than
 * posting it twice. From version 5 an item is a thread of messages, and
 * a post is the agent's message on it: its words, and the ask they end
 * with, held open by the item (`open_ask_message_id`), any ask held open
 * before replaced, only the standing keys of an ask's JSON ever rewritten.
 * The row keeps the title, blocks, and response beside the thread as the
 * view of that ask a desktop before version 5 reads, as the wire's own JSON
 * under the version of the vocabulary that wrote them, decoded on every
 * read against the wire's closed shapes; a post that asks nothing waits on
 * nobody, and its item stands to such a desktop as a note already settled,
 * its words its message. An image block is posted by a path and kept by an
 * attachment: the caller reads the file's bytes from the agent's sandbox
 * and hands them in beside the post, and the post writes each as a file of
 * its message (`@luke/database/schemas/attachment`) under an id minted
 * here, which the block kept on the item names in the path's place; the
 * item's own files from before version 5 go with the same write. A post
 * counts the agent's open items against the bound
 * under a lock on the agent's own row, so two posts of one step cannot both
 * slip under it. Only what the agent asks moves the revision: a post, or a
 * close, which withdraws the ask held open with its reason. An answer by
 * revision, as a desktop before version 5 sends one, is taken only by the
 * revision it names and only while the item is open, so an answer to an
 * item the agent has since changed is refused rather than taken for what
 * it now asks; an answer by the ask's message, from version 5, only while
 * the item holds that ask open, checked against it. Either is written as
 * the member's message that answers the ask, under the answer's key, with
 * its words and its files, the ask stood answered and the item answered
 * with the answer's view; an item from before version 5, which holds no
 * ask, keeps the answer and its files as its own, deleted when the agent
 * posts the item again. An answer sent again under the key it was taken by
 * finds it taken, and one taken back takes its message with it and opens
 * the ask again. A member may instead close the item without an answer,
 * at the revision they were shown, which withdraws the ask it holds open
 * with no reason, an agent's close always giving one, and moves no
 * revision; a close taken back opens the ask again. A member of the item's
 * workspace, or the item's agent, writes a message on its thread at any
 * point, open or settled: the message and its files are written in one
 * write that moves the item's last change and nothing else of it, so every
 * read that compares where items stand sees the thread move, and a member's
 * message sent again under its key finds the one it wrote. A post under the
 * item's key leaves the thread and its files standing. A read carries the
 * thread twice: as a desktop before version 5 draws it, without the
 * messages that ask or answer, which the item's own fields stand for; and
 * whole, its first message and the ask it holds open however long it runs,
 * each ask as it stands on the item, so one a deployment from before
 * version 5 left open while it closed the item reads withdrawn. What waits across
 * the account, every open item on a task it has not archived, is read on
 * its own index, so a desktop can hold that read whichever task is open.
 * Every read of an item says whether it is unread for the member reading
 * it, by that member's own marker (`@luke/database/schemas/inbox-item-read`):
 * an item is unread while it changed after the last change they read
 * through, or while they marked it unread and have not read it since. A
 * member's own answer or message marks it read for them in the same write,
 * and marking an item read, or every item their Inbox lists, writes only
 * their own marker and only where it moves, so opening an item already
 * read writes nothing. The stamps a held read compares carry the reader's
 * unread state too, so a marker moved wakes that member's held reads.
 * Every function is an effect over the ambient `SqlClient` and names no
 * database of its own.
 */

type InboxStoreFailure = QueryError | Schema.SchemaError;

/** What an inbox store operation answers: an effect over the ambient client, composed into whatever called it. */
export type InboxStoreEffect<A> = Effect.Effect<A, InboxStoreFailure, DatabaseServices>;

/** The agent an item belongs to, as every write of the agent's names it: the task it works on, or none for an agent an automation started with no task. */
export interface InboxAgent {
  readonly userId: string;
  readonly taskId: string | null;
  readonly agentId: string;
}

/** Why a post was not written. */
export const INBOX_POST_REFUSAL = {
  /** The agent holds as many open items as it may; it closes one first. */
  TOO_MANY_OPEN: "too-many-open",
  /** The agent is no longer the account's. */
  NO_AGENT: "no-agent",
} as const;

export type InboxPostRefusal = (typeof INBOX_POST_REFUSAL)[keyof typeof INBOX_POST_REFUSAL];

/** Where one item stands, without what it says. */
export interface InboxStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: InboxItem["status"];
  readonly updatedAt: number;
  /** Whether the item is unread for the member the stamps were read for. */
  readonly unread: boolean;
}

/** An item as the service holds it, beyond what the wire carries: the key its answer was taken under. */
export interface StoredInboxItem {
  readonly item: InboxItem;
  readonly answerKey: string | null;
}

/** One picture as a post hands it in and a read answers it: the type its bytes were sniffed to be, and the bytes. */
export interface InboxImage {
  readonly contentType: InboxImageType;
  readonly bytes: Uint8Array;
}

/** A picture as the agent's message on a thread carries it: its file's own name, the type its bytes were sniffed to be, and the bytes. */
export interface InboxNamedImage extends InboxImage {
  readonly name: string;
}

/** One file of a message's as the store writes it: its own name, its type, and its bytes. */
interface MessageFile {
  /** The id it is kept under, where the message's words name it by its address; minted by the database where none is given. */
  readonly id?: string;
  readonly name: string;
  readonly contentType: CodingAgentAttachmentType;
  readonly bytes: Uint8Array;
}

/** A file an item's answer carried as a read answers it: the type it travelled as, and the bytes; a picture of a block's reads the same way. */
export interface InboxFile {
  readonly contentType: CodingAgentAttachmentType;
  readonly bytes: Uint8Array;
}

/** The types a file of an item's may be served under: a picture's, or any a message's file travels as. */
const inboxFileTypeSchema = Schema.Literals(Object.values(CODING_AGENT_ATTACHMENT_TYPE));

/** The item's own id, named by its table, since a statement over the item alone spells its columns bare and a bare id inside the files' subquery would be the file's. */
const ITEM_ID = sql`${sql.identifier(getTableName(inboxItem))}.${sql.identifier(inboxItem.id.name)}`;

/** A column named by its table, for a subquery nested inside another whose own columns would otherwise take the bare name. */
function qualified(table: AnyPgTable, column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;
}

/** The message whose ask the item holds open, named by the item's table, for the subqueries nested in a read of the item. */
const ITEM_OPEN_ASK = qualified(inboxItem, inboxItem.openAskMessageId);

/** The key the item's answer was taken under, named by the item's table, for the subqueries nested in a read of the item. */
const ITEM_ANSWER_KEY = qualified(inboxItem, inboxItem.answerKey);

/**
 * The files the item's answer carried, in the order they were attached,
 * each named by its attachment, its name, and its type: the answer's own
 * files, as an answer to an item that asked nothing kept them, or the
 * files of the message that answered its ask, which carries the answer's
 * key, while the answer stands.
 */
const ANSWER_FILES = sql<unknown>`(select coalesce(jsonb_agg(jsonb_build_object('attachmentId', ${attachment.id}, 'name', ${attachment.name}, 'mediaType', ${attachment.contentType}) order by ${attachment.position}), '[]'::jsonb) from ${attachment} where ${attachment.inboxItemId} = ${ITEM_ID} and (${attachment.kind} = ${INBOX_ATTACHMENT_KIND.ANSWER} or ${attachment.inboxMessageId} = (select ${inboxMessage.id} from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} and ${inboxMessage.clientKey} = ${ITEM_ANSWER_KEY} and ${inboxMessage.answers} is not null)))`;

const MESSAGE = {
  id: qualified(inboxMessage, inboxMessage.id),
  author: qualified(inboxMessage, inboxMessage.author),
  userId: qualified(inboxMessage, inboxMessage.userId),
  text: qualified(inboxMessage, inboxMessage.text),
  ask: qualified(inboxMessage, inboxMessage.ask),
  answers: qualified(inboxMessage, inboxMessage.answers),
  createdAt: qualified(inboxMessage, inboxMessage.createdAt),
};

/** The files one message of the thread carried, in the order they were attached, each named as an answer's file is. */
const MESSAGE_FILES = sql`(select coalesce(jsonb_agg(jsonb_build_object('attachmentId', ${attachment.id}, 'name', ${attachment.name}, 'mediaType', ${attachment.contentType}) order by ${attachment.position}), '[]'::jsonb) from ${attachment} where ${attachment.inboxMessageId} = ${MESSAGE.id})`;

/** As many messages as a read carries. */
const MESSAGES_READ = sql.raw(String(INBOX_BOUNDS.MAX_MESSAGES_READ));

/** A set of the item's messages under the table's own name, so the columns above name them. */
function messagesAs(select: SQL): SQL {
  return sql`(${select}) as ${sql.identifier(getTableName(inboxMessage))}`;
}

/**
 * The item's latest messages that neither ask nor answer, as many as a
 * read carries: the thread as a desktop before version 5 draws it, since
 * the item's blocks, response, and answer stand for the rest.
 */
const LATEST_PLAIN_MESSAGES = messagesAs(
  sql`select * from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} and ${inboxMessage.ask} is null and ${inboxMessage.answers} is null order by ${inboxMessage.createdAt} desc, ${inboxMessage.id} desc limit ${MESSAGES_READ}`,
);

/**
 * The item's whole thread as a read carries it: its latest messages, as
 * many as a read carries, and its first message and the one whose ask it
 * holds open, however many were written since, so a long thread never
 * loses what opened it or what waits on an answer.
 */
const THREAD_MESSAGES = messagesAs(
  sql`select * from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} and (${inboxMessage.id} in (select ${inboxMessage.id} from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} order by ${inboxMessage.createdAt} desc, ${inboxMessage.id} desc limit ${MESSAGES_READ}) or ${inboxMessage.id} = (select ${inboxMessage.id} from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} order by ${inboxMessage.createdAt}, ${inboxMessage.id} limit 1) or ${inboxMessage.id} = ${ITEM_OPEN_ASK})`,
);

/**
 * Messages oldest first, each with its author, the member's name as their
 * account holds it now, its words, its files, the ask it ends with and the
 * answer it carries as they were kept, and when it was written in epoch
 * milliseconds.
 */
function messagesOf(source: SQL): SQL<unknown> {
  return sql<unknown>`(select coalesce(jsonb_agg(jsonb_build_object('id', ${MESSAGE.id}, 'author', ${MESSAGE.author}, 'userId', ${MESSAGE.userId}, 'name', (select "name" from ${user} where ${user.id} = ${MESSAGE.userId}), 'text', ${MESSAGE.text}, 'files', ${MESSAGE_FILES}, 'ask', ${MESSAGE.ask}, 'answers', ${MESSAGE.answers}, 'createdAt', floor(extract(epoch from ${MESSAGE.createdAt}) * 1000)::bigint) order by ${MESSAGE.createdAt}, ${MESSAGE.id}), '[]'::jsonb) from ${source})`;
}

/** Whether the item is settled: answered, or closed by its agent. */
const SETTLED = sql`${inboxItem.status} <> ${INBOX_STATUS.OPEN}`;

const ITEM_TABLE = sql.identifier(getTableName(inboxItem));
const ITEM_UPDATED_AT = sql`${ITEM_TABLE}.${sql.identifier(inboxItem.updatedAt.name)}`;
const ITEM_READ_THROUGH = sql`${ITEM_TABLE}.${sql.identifier(inboxItem.readThrough.name)}`;

const READ = {
  itemId: qualified(inboxItemRead, inboxItemRead.itemId),
  userId: qualified(inboxItemRead, inboxItemRead.userId),
  readThrough: qualified(inboxItemRead, inboxItemRead.readThrough),
  markedUnread: qualified(inboxItemRead, inboxItemRead.markedUnread),
};

/**
 * Whether the item is unread for the reader: marked unread by them, or
 * changed after the later of the change they read through and the instant
 * the item itself is read through by everyone, which stands only on an item
 * from before unread was kept. A reader with no marker reads it by the
 * item's instant alone, so an item posted since is unread until they read
 * it and one that stood before is read until it changes.
 */
function unreadFor(readerId: string): SQL<boolean> {
  const noMarker = sql`${ITEM_UPDATED_AT} > coalesce(${ITEM_READ_THROUGH}, '-infinity'::timestamptz)`;
  return sql<boolean>`coalesce((select ${READ.markedUnread} or ${ITEM_UPDATED_AT} > coalesce(greatest(${READ.readThrough}, ${ITEM_READ_THROUGH}), '-infinity'::timestamptz) from ${inboxItemRead} where ${READ.itemId} = ${ITEM_ID} and ${READ.userId} = ${readerId}), ${noMarker})`;
}

/**
 * When a settled item was settled, in epoch milliseconds: the instant kept,
 * or, on an item settled before it was kept, its last change, which no
 * message has moved yet, since the first one keeps that instant first.
 */
const SETTLED_AT = sql<
  number | null
>`floor(extract(epoch from coalesce(${inboxItem.settledAt}, case when ${SETTLED} then ${inboxItem.updatedAt} end)) * 1000)::float8`;

/** The columns every read and every `returning` projects for the reader, so a row decodes one way whatever wrote it. */
function inboxColumns(readerId: string) {
  return {
    ...INBOX_ITEM_COLUMNS,
    unread: unreadFor(readerId),
  };
}

/** What an item says whoever reads it. */
const INBOX_ITEM_COLUMNS = {
  id: inboxItem.id,
  agentId: inboxItem.agentId,
  key: inboxItem.key,
  revision: inboxItem.revision,
  version: inboxItem.version,
  title: inboxItem.title,
  blocks: inboxItem.blocks,
  response: inboxItem.response,
  needsReply: inboxItem.needsReply,
  status: inboxItem.status,
  startedBy: inboxItem.userId,
  startedByName: sql<
    string | null
  >`(select "name" from ${user} where ${user.id} = ${inboxItem.userId})`,
  answer: inboxItem.answer,
  answerFiles: ANSWER_FILES,
  answerKey: inboxItem.answerKey,
  answeredBy: inboxItem.answeredBy,
  // A scalar read rather than a join, because `returning` projects these too and joins nothing.
  answeredByName: sql<
    string | null
  >`(select "name" from ${user} where ${user.id} = ${inboxItem.answeredBy})`,
  closedReason: inboxItem.closedReason,
  closedBy: inboxItem.closedBy,
  closedByName: sql<
    string | null
  >`(select "name" from ${user} where ${user.id} = ${inboxItem.closedBy})`,
  messages: messagesOf(LATEST_PLAIN_MESSAGES),
  thread: messagesOf(THREAD_MESSAGES),
  openAskMessageId: inboxItem.openAskMessageId,
  postedAt: inboxItem.postedAt,
  settledAt: SETTLED_AT,
  updatedAt: inboxItem.updatedAt,
};

const FileRowSchema = Schema.Struct({
  attachmentId: Schema.String,
  name: Schema.String,
  mediaType: Schema.String,
});

const MessageRowSchema = Schema.Struct({
  id: Schema.String,
  author: Schema.Literals(Object.values(INBOX_MESSAGE_AUTHOR)),
  userId: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  text: Schema.String,
  files: Schema.Array(FileRowSchema),
  ask: Schema.NullOr(inboxReadAskSchema),
  answers: Schema.NullOr(inboxAnswersSchema),
  createdAt: Schema.Number,
});

type MessageRow = typeof MessageRowSchema.Type;

/** Where an item stands, as each ask of its thread is read against it. */
interface AskStanding {
  readonly status: InboxItem["status"];
  readonly response: InboxResponse;
  readonly openAskMessageId: string | null;
  readonly closedReason: string | null;
}

/**
 * Whether the item's response still stands for the ask: the ask a response
 * maps to is the ask itself, a to-do any `do` ask, whose steps its blocks
 * carry. A post from before version 5 rewrites the response and not the
 * thread, so an ask it posted over stands for it no longer.
 */
function askStandsFor(response: InboxResponse, ask: InboxAsk): boolean {
  const asked = inboxResponseAsk(response);
  if (asked === undefined || asked.type !== ask.type) return false;
  return asked.type === INBOX_ASK.DO || isDeepStrictEqual(asked, ask);
}

/** Whether the ask held open is still the one the item asks: an ask of a type a newer deployment wrote is taken at its word. */
function askStillAsked(response: InboxResponse, ask: InboxReadAsk): boolean {
  const known = knownAsk(ask);
  return known === undefined || askStandsFor(response, known);
}

/**
 * An ask as a read carries it: as it was kept, unless it was kept open and
 * the item no longer holds it open, which a deployment from before version
 * 5 leaves by closing the item without a word to the ask; then withdrawn
 * with the item's reason where the item closed on it, answered where the
 * item was answered on it, and replaced where the item holds another or,
 * posted over from before version 5, asks something else.
 * Note that an ask withdrawn with no reason is a member's close without an
 * answer, the item's `closedBy` naming the member while the close stands,
 * because an agent's close always says why: a reader tells the two closes
 * apart by the reason alone, as it tells a closed item's.
 */
function standingAsk(ask: InboxReadAsk, messageId: string, item: AskStanding): InboxReadAsk {
  if (ask.status !== INBOX_ASK_STATUS.OPEN) return ask;
  const replaced = { ...ask, status: INBOX_ASK_STATUS.REPLACED };
  if (messageId !== item.openAskMessageId) return replaced;
  switch (item.status) {
    case INBOX_STATUS.OPEN:
      return askStillAsked(item.response, ask) ? ask : replaced;
    case INBOX_STATUS.ANSWERED:
      return { ...ask, status: INBOX_ASK_STATUS.ANSWERED };
    case INBOX_STATUS.CLOSED:
      return item.closedReason === null
        ? { ...ask, status: INBOX_ASK_STATUS.WITHDRAWN }
        : { ...ask, status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnReason: item.closedReason };
  }
}

/** A message as the wire carries it: the member named where their account stands, no files where it carried none, and its ask as it stands on the item. */
function storedMessage(row: MessageRow, item: AskStanding): InboxMessage {
  return {
    id: row.id,
    author: row.author,
    ...(row.userId === null || row.name === null
      ? undefined
      : { member: { userId: row.userId, name: row.name } }),
    text: row.text,
    ...(row.files.length === 0 ? undefined : { files: row.files }),
    ...(row.ask === null ? undefined : { ask: standingAsk(row.ask, row.id, item) }),
    ...(row.answers === null ? undefined : { answers: row.answers }),
    createdAt: row.createdAt,
  };
}

const InboxRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  key: Schema.String,
  revision: Schema.Number,
  version: Schema.Number,
  title: Schema.String,
  blocks: Schema.Array(inboxBlockSchema),
  response: inboxResponseSchema,
  needsReply: Schema.Boolean,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  startedBy: Schema.String,
  startedByName: Schema.NullOr(Schema.String),
  answer: Schema.NullOr(inboxReplySchema),
  answerFiles: Schema.Array(FileRowSchema),
  answerKey: Schema.NullOr(Schema.String),
  answeredBy: Schema.NullOr(Schema.String),
  answeredByName: Schema.NullOr(Schema.String),
  closedReason: Schema.NullOr(Schema.String),
  closedBy: Schema.NullOr(Schema.String),
  closedByName: Schema.NullOr(Schema.String),
  messages: Schema.Array(MessageRowSchema),
  thread: Schema.Array(MessageRowSchema),
  openAskMessageId: Schema.NullOr(Schema.String),
  postedAt: InstantColumnSchema,
  settledAt: Schema.NullOr(Schema.Number),
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
});

type InboxRow = typeof InboxRowSchema.Type;

/** A row as the wire carries it, each absent field left out rather than null. */
function storedItem(row: InboxRow): StoredInboxItem {
  const message = (each: MessageRow) => storedMessage(each, row);
  return {
    item: {
      id: row.id,
      agentId: row.agentId,
      key: row.key,
      revision: row.revision,
      version: row.version,
      title: row.title,
      blocks: row.blocks,
      response: row.response,
      needsReply: row.needsReply,
      status: row.status,
      ...(row.startedByName === null
        ? undefined
        : { startedBy: { userId: row.startedBy, name: row.startedByName } }),
      ...(row.answer === null ? undefined : { answer: row.answer }),
      ...(row.answerFiles.length === 0 ? undefined : { answerFiles: row.answerFiles }),
      ...(row.answeredBy === null || row.answeredByName === null
        ? undefined
        : { answeredBy: { userId: row.answeredBy, name: row.answeredByName } }),
      ...(row.closedReason === null ? undefined : { closedReason: row.closedReason }),
      ...(row.closedBy === null || row.closedByName === null
        ? undefined
        : { closedBy: { userId: row.closedBy, name: row.closedByName } }),
      ...(row.messages.length === 0 ? undefined : { messages: row.messages.map(message) }),
      ...(row.thread.length === 0 ? undefined : { thread: row.thread.map(message) }),
      postedAt: row.postedAt.getTime(),
      ...(row.settledAt === null ? undefined : { settledAt: row.settledAt }),
      updatedAt: row.updatedAt.getTime(),
      unread: row.unread,
    },
    answerKey: row.answerKey,
  };
}

const AgentKeySchema = Schema.Struct({ userId: Schema.String, agentId: Schema.String });

/** An item row's workspace: its own, or its task's on a row the backfill has not reached yet. */
const ITEM_WORKSPACE = sql<string>`coalesce(${inboxItem.organizationId}, (select ${task.organizationId} from ${task} where ${task.id} = ${inboxItem.taskId}))`;

/** The condition that the account is a member of the workspace of the item a statement reads, an item of an agent with no task as much as one on a task. */
function itemReachableBy(userId: string): SQL {
  return workspaceReachableBy(userId, ITEM_WORKSPACE);
}

/** The step a link names the agent's workspace by: its slug, or its id where it has none, as a plan's picture names it. */
const AGENT_WORKSPACE_STEP = sql<string>`coalesce((select ${organization.slug} from ${organization} where ${organization.id} = ${AGENT_WORKSPACE}), ${AGENT_WORKSPACE})`;

/** The agent's row under its own lock, where the account started it and is still a member of its workspace, which serializes one agent's posts. */
const lockAgent = SqlSchema.findOneOption({
  Request: AgentKeySchema,
  Result: Schema.Struct({
    id: Schema.String,
    organizationId: Schema.String,
    workspaceStep: Schema.String,
  }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          id: codingAgent.id,
          organizationId: AGENT_WORKSPACE,
          workspaceStep: AGENT_WORKSPACE_STEP,
        })
        .from(codingAgent)
        .where(
          and(
            eq(codingAgent.id, agentId),
            eq(codingAgent.userId, userId),
            agentReachableBy(userId),
          ),
        )
        .for("update"),
    ),
});

/** How many items the agent holds open under a key other than the one given. */
const countOpenBesides = SqlSchema.findOne({
  Request: Schema.Struct({ ...AgentKeySchema.fields, key: Schema.String }),
  Result: Schema.Struct({ open: Schema.Number }),
  execute: ({ userId, agentId, key }) =>
    Database.use((db) =>
      db
        .select({ open: sql<number>`count(*)::int` })
        .from(inboxItem)
        .where(
          and(
            eq(inboxItem.userId, userId),
            eq(inboxItem.agentId, agentId),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
            ne(inboxItem.key, key),
          ),
        ),
    ),
});

const PostWriteSchema = Schema.Struct({
  userId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
  agentId: Schema.String,
  key: Schema.String,
  title: Schema.String,
  blocks: Schema.Array(inboxBlockSchema),
  response: inboxResponseSchema,
  needsReply: Schema.Boolean,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  settledAt: Schema.NullOr(Schema.Date),
  now: Schema.Date,
});

const AnswerFileWriteSchema = Schema.Struct({
  userId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
  itemId: Schema.String,
  name: Schema.String,
  position: Schema.Number,
  contentType: inboxFileTypeSchema,
  bytes: Schema.Uint8Array,
  now: Schema.Date,
});

/** One file of the answer's written as a row of the item's, at its place among the answer's files. */
const insertAnswerFile = SqlSchema.void({
  Request: AnswerFileWriteSchema,
  execute: ({ now, itemId, ...file }) =>
    Database.use((db) =>
      db.insert(attachment).values({
        ...file,
        inboxItemId: itemId,
        kind: INBOX_ATTACHMENT_KIND.ANSWER,
        byteCount: file.bytes.byteLength,
        createdAt: now,
      }),
    ),
});

/** The item's answer files, deleted: the answer they came with no longer stands. */
const deleteAnswerFiles = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String }),
  execute: ({ itemId }) =>
    Database.use((db) =>
      db
        .delete(attachment)
        .where(
          and(
            eq(attachment.inboxItemId, itemId),
            eq(attachment.kind, INBOX_ATTACHMENT_KIND.ANSWER),
          ),
        ),
    ),
});

/**
 * The item's own files, which no message of its thread carries, deleted:
 * the pictures a post from before version 5 kept for its blocks, and the
 * files of an answer that answered no ask, since a post clears the
 * answer. Note that every message's files are kept, a post's pictures and
 * an answering message's files among them, because a post leaves the
 * thread standing.
 */
const deleteItemFiles = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String }),
  execute: ({ itemId }) =>
    Database.use((db) =>
      db
        .delete(attachment)
        .where(
          and(
            eq(attachment.inboxItemId, itemId),
            ne(attachment.kind, INBOX_ATTACHMENT_KIND.MESSAGE),
          ),
        ),
    ),
});

const MessageWriteSchema = Schema.Struct({
  itemId: Schema.String,
  author: Schema.Literals(Object.values(INBOX_MESSAGE_AUTHOR)),
  userId: Schema.NullOr(Schema.String),
  text: Schema.String,
  // Note that the ask is taken as it is typed, because it is written as the read shape whole and a type a newer deployment named encodes to no other shape.
  ask: Schema.NullOr(Schema.toType(inboxReadAskSchema)),
  answers: Schema.NullOr(inboxAnswersSchema),
  clientKey: Schema.NullOr(Schema.String),
  now: Schema.Date,
});

/** The message written on the item's thread; nothing where a message of the item's stands under its key already. */
const insertMessage = SqlSchema.findOneOption({
  Request: MessageWriteSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ now, ...message }) =>
    Database.use((db) =>
      db
        .insert(inboxMessage)
        .values({ ...message, createdAt: now })
        .onConflictDoNothing()
        .returning({ id: inboxMessage.id }),
    ),
});

const MessageFileWriteSchema = Schema.Struct({
  ...AnswerFileWriteSchema.fields,
  messageId: Schema.String,
  /** The id the file is kept under, where the message's words name it; minted by the database where none is given. */
  id: Schema.optionalKey(Schema.String),
});

/** One file of a message's written as a row of the item's, naming the message, at its place among the message's files. */
const insertMessageFile = SqlSchema.void({
  Request: MessageFileWriteSchema,
  execute: ({ now, itemId, messageId, ...file }) =>
    Database.use((db) =>
      db.insert(attachment).values({
        ...file,
        inboxItemId: itemId,
        inboxMessageId: messageId,
        kind: INBOX_ATTACHMENT_KIND.MESSAGE,
        byteCount: file.bytes.byteLength,
        createdAt: now,
      }),
    ),
});

/** Where an ask is to stand: open again, answered, replaced, or withdrawn with why. */
const AskStandingSchema = Schema.Struct({
  status: Schema.Literals(Object.values(INBOX_ASK_STATUS)),
  withdrawnReason: Schema.NullOr(Schema.String),
});

/**
 * The keys of an ask's standing merged over the ask as it was kept. Note
 * that nothing else of the ask is written, because a deployment that does
 * not know the ask's type must never strip the keys it does not read.
 */
function askStanding({ status, withdrawnReason }: typeof AskStandingSchema.Type): SQL {
  const standing =
    withdrawnReason === null
      ? sql`jsonb_build_object('status', ${status}::text)`
      : sql`jsonb_build_object('status', ${status}::text, 'withdrawnReason', ${withdrawnReason}::text)`;
  return sql`${inboxMessage.ask} || ${standing}`;
}

/** Whether a message's ask stands open, as it was kept. */
const ASK_KEPT_OPEN = sql`${inboxMessage.ask} ->> 'status' = ${INBOX_ASK_STATUS.OPEN}`;

/** Every ask of the item kept open, but the one message's named, set to stand as given: what a post replaces and a close withdraws. */
const settleOpenAsks = SqlSchema.void({
  Request: Schema.Struct({
    ...AskStandingSchema.fields,
    itemId: Schema.String,
    except: Schema.NullOr(Schema.String),
  }),
  execute: ({ itemId, except, ...standing }) =>
    Database.use((db) =>
      db
        .update(inboxMessage)
        .set({ ask: askStanding(standing) })
        .where(
          and(
            eq(inboxMessage.itemId, itemId),
            ASK_KEPT_OPEN,
            except === null ? undefined : ne(inboxMessage.id, except),
          ),
        ),
    ),
});

/** The ask of the one message named set to stand as given: what an answer settles and an answer taken back opens again. */
const standAsk = SqlSchema.void({
  Request: Schema.Struct({ ...AskStandingSchema.fields, messageId: Schema.String }),
  execute: ({ messageId, ...standing }) =>
    Database.use((db) =>
      db
        .update(inboxMessage)
        .set({ ask: askStanding(standing) })
        .where(and(eq(inboxMessage.id, messageId), isNotNull(inboxMessage.ask))),
    ),
});

/** The item pointed at the message whose ask it now holds open. */
const holdAsk = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, messageId: Schema.String }),
  execute: ({ itemId, messageId }) =>
    Database.use((db) =>
      db.update(inboxItem).set({ openAskMessageId: messageId }).where(eq(inboxItem.id, itemId)),
    ),
});

/** The ask the item holds open, by its message, with the response the item asks, where the account reaches the item and it stands open: the ask an answer settles. */
const findOpenAsk = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, itemId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    ask: inboxReadAskSchema,
    response: inboxResponseSchema,
  }),
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select({ id: inboxMessage.id, ask: inboxMessage.ask, response: inboxItem.response })
        .from(inboxMessage)
        .innerJoin(inboxItem, eq(inboxItem.openAskMessageId, inboxMessage.id))
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemReachableBy(userId),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
            ASK_KEPT_OPEN,
          ),
        ),
    ),
});

/** The member's message on the item under the answer's key that carries an answer, with the answer: what taking the answer back deletes, opening its ask again. */
const findAnsweringMessage = SqlSchema.findOneOption({
  Request: Schema.Struct({ itemId: Schema.String, clientKey: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, answers: inboxAnswersSchema }),
  execute: ({ itemId, clientKey }) =>
    Database.use((db) =>
      db
        .select({ id: inboxMessage.id, answers: inboxMessage.answers })
        .from(inboxMessage)
        .where(
          and(
            eq(inboxMessage.itemId, itemId),
            eq(inboxMessage.clientKey, clientKey),
            isNotNull(inboxMessage.answers),
          ),
        ),
    ),
});

/**
 * The item's last change moved to now, and nothing else of it: what a
 * message on its thread does to the item. Note that a settled item settled
 * before the instant was kept keeps its last change as that instant first,
 * because the change is what a read took it for until now.
 */
const touchItem = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, now: Schema.Date }),
  execute: ({ itemId, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          settledAt: sql`case when ${SETTLED} then coalesce(${inboxItem.settledAt}, ${inboxItem.updatedAt}) end`,
          updatedAt: now,
        })
        .where(eq(inboxItem.id, itemId)),
    ),
});

/** The message the member's client wrote under its key on the item, deleted with its files; nothing else of the thread is. */
const deleteMessage = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, clientKey: Schema.String }),
  execute: ({ itemId, clientKey }) =>
    Database.use((db) =>
      db
        .delete(inboxMessage)
        .where(and(eq(inboxMessage.itemId, itemId), eq(inboxMessage.clientKey, clientKey))),
    ),
});

/** The attachment, a block's picture or an answer's file, where it is the item's and the account reaches the item's task: its type and its bytes. */
const findAttachment = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    attachmentId: Schema.String,
  }),
  Result: Schema.Struct({ contentType: inboxFileTypeSchema, bytes: Schema.Uint8Array }),
  execute: ({ userId, itemId, attachmentId }) =>
    Database.use((db) =>
      db
        .select({ contentType: attachment.contentType, bytes: attachment.bytes })
        .from(attachment)
        .innerJoin(inboxItem, eq(inboxItem.id, attachment.inboxItemId))
        .where(
          and(
            eq(attachment.inboxItemId, itemId),
            eq(attachment.id, attachmentId),
            itemReachableBy(userId),
          ),
        ),
    ),
});

/** The blocks as the item keeps them: each image block naming the attachment minted for it, in the order the images were handed in, and every other block as posted. */
function storedBlocks(
  blocks: readonly InboxPostBlock[],
  attachmentIds: readonly string[],
): readonly InboxBlock[] {
  let next = 0;
  return blocks.map((block): InboxBlock => {
    if (block.type !== INBOX_BLOCK.IMAGE) return block;
    const attachmentId = attachmentIds[next];
    next += 1;
    // The caller hands one picture per image block; fewer is its contract broken, not an outcome.
    if (attachmentId === undefined) throw new Error("an image block has no picture handed in");
    return { type: INBOX_BLOCK.IMAGE, attachmentId, alt: block.alt };
  });
}

/**
 * The item written under the agent's key as the view of what its post
 * asks: a new row at revision one, or the standing one written again, its
 * revision moved on, its answer cleared, and no ask held open until the
 * post's own message is written; its id.
 */
const upsertItem = SqlSchema.findOne({
  Request: PostWriteSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (write) => {
    const posted = {
      version: INBOX_WIRE_VERSION,
      title: write.title,
      blocks: write.blocks,
      response: write.response,
      needsReply: write.needsReply,
      status: write.status,
      answer: null,
      answerKey: null,
      answeredBy: null,
      closedReason: null,
      closedBy: null,
      settledAt: write.settledAt,
      updatedAt: write.now,
      openAskMessageId: null,
    };
    return Database.use((db) =>
      db
        .insert(inboxItem)
        .values({
          userId: write.userId,
          taskId: write.taskId,
          organizationId: write.organizationId,
          agentId: write.agentId,
          key: write.key,
          revision: 1,
          postedAt: write.now,
          ...posted,
        })
        .onConflictDoUpdate({
          target: [inboxItem.agentId, inboxItem.key],
          set: { ...posted, revision: sql`${inboxItem.revision} + 1` },
        })
        .returning({ id: inboxItem.id }),
    );
  },
});

/** The agent's item under the key closed with why, its revision moved on and no ask held open; its id, or nothing where the agent has no item under it. */
const closeItem = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...AgentKeySchema.fields,
    key: Schema.String,
    reason: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId, key, reason, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.CLOSED,
          closedReason: reason,
          closedBy: null,
          revision: sql`${inboxItem.revision} + 1`,
          settledAt: now,
          updatedAt: now,
          openAskMessageId: null,
        })
        .where(
          and(eq(inboxItem.userId, userId), eq(inboxItem.agentId, agentId), eq(inboxItem.key, key)),
        )
        .returning({ id: inboxItem.id }),
    ),
});

/** Where a read looks: one task's items, any member's agents' alike; one agent's own, under the member who started it; or one agent's, as any member of its workspace reads them. */
const INBOX_SCOPE = {
  TASK: "plan",
  AGENT: "agent",
  AGENT_OF_WORKSPACE: "agent-of-workspace",
} as const;

const ScopeSchema = Schema.Struct({
  userId: Schema.String,
  scope: Schema.Literals(Object.values(INBOX_SCOPE)),
  id: Schema.String,
});

type InboxScope = typeof ScopeSchema.Type;

/** The rows a scope names: the task's or the agent's where the account is a member of their workspace, or the agent's under the account that started it. */
function inScope(scope: InboxScope) {
  switch (scope.scope) {
    case INBOX_SCOPE.TASK:
      return and(eq(inboxItem.taskId, scope.id), itemReachableBy(scope.userId));
    case INBOX_SCOPE.AGENT_OF_WORKSPACE:
      return and(eq(inboxItem.agentId, scope.id), itemReachableBy(scope.userId));
    case INBOX_SCOPE.AGENT:
      return and(eq(inboxItem.agentId, scope.id), eq(inboxItem.userId, scope.userId));
  }
}

/** The order every read keeps: the latest changed first, and by id among those changed at one instant, so two reads of the same rows agree. */
const LATEST_FIRST = [desc(inboxItem.updatedAt), desc(inboxItem.id)] as const;

/** Every open item the scope holds, however long ago it last changed; the open bound per agent keeps these few. */
const findOpenItems = SqlSchema.findAll({
  Request: ScopeSchema,
  Result: InboxRowSchema,
  execute: (scope) =>
    Database.use((db) =>
      db
        .select(inboxColumns(scope.userId))
        .from(inboxItem)
        .where(and(inScope(scope), eq(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST),
    ),
});

/** The scope's settled items, the latest changed first, as many as the read carries. */
const findSettledItems = SqlSchema.findAll({
  Request: Schema.Struct({ ...ScopeSchema.fields, limit: Schema.Number }),
  Result: InboxRowSchema,
  execute: ({ limit, ...scope }) =>
    Database.use((db) =>
      db
        .select(inboxColumns(scope.userId))
        .from(inboxItem)
        .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST)
        .limit(limit),
    ),
});

/** Where one item stands, without what it says: what a held read compares between looks. */
const StampRowSchema = Schema.Struct({
  id: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
});

/** Where an item stands for the reader: its own stamp, and whether it is unread for them, so their marker moving wakes their held reads. */
function stampColumns(readerId: string) {
  return {
    id: inboxItem.id,
    revision: inboxItem.revision,
    status: inboxItem.status,
    updatedAt: inboxItem.updatedAt,
    unread: unreadFor(readerId),
  };
}

const findOpenStamps = SqlSchema.findAll({
  Request: ScopeSchema,
  Result: StampRowSchema,
  execute: (scope) =>
    Database.use((db) =>
      db
        .select(stampColumns(scope.userId))
        .from(inboxItem)
        .where(and(inScope(scope), eq(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST),
    ),
});

const findSettledStamps = SqlSchema.findAll({
  Request: Schema.Struct({ ...ScopeSchema.fields, limit: Schema.Number }),
  Result: StampRowSchema,
  execute: ({ limit, ...scope }) =>
    Database.use((db) =>
      db
        .select(stampColumns(scope.userId))
        .from(inboxItem)
        .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST)
        .limit(limit),
    ),
});

/**
 * The open items on the tasks of the account's workspaces it has not
 * archived, whichever member's agent posted each: the rows the account's
 * read of what waits names.
 */
function accountWaiting(userId: string) {
  return and(
    taskReachableBy(userId),
    eq(inboxItem.status, INBOX_STATUS.OPEN),
    isNull(task.archivedAt),
  );
}

/** The open items of agents with no task in the account's workspaces, whichever member's agent posted each: what the account's read names beside the tasks' items. */
function tasklessWaiting(userId: string) {
  return and(
    isNull(inboxItem.taskId),
    itemReachableBy(userId),
    eq(inboxItem.status, INBOX_STATUS.OPEN),
  );
}

const AccountRequestSchema = Schema.Struct({ userId: Schema.String });

/** One open item as the account's read carries it, with its agent as its row names it now. */
const WaitingRowSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  startedBy: Schema.String,
  title: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
});

const findWaitingItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: WaitingRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: inboxItem.id,
          taskId: inboxItem.taskId,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          status: inboxItem.status,
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
          unread: unreadFor(userId),
        })
        .from(inboxItem)
        .innerJoin(task, eq(task.id, inboxItem.taskId))
        .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
        .where(accountWaiting(userId))
        .orderBy(...LATEST_FIRST),
    ),
});

/** One open item of an agent with no task as the account's read carries it, with its automation and repository where a task's item names its task. */
const TasklessRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  startedBy: Schema.String,
  automationId: Schema.NullOr(Schema.String),
  automationName: Schema.NullOr(Schema.String),
  repository: Schema.String,
  workspaceId: Schema.NullOr(Schema.String),
  title: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
});

const findTasklessWaitingItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: TasklessRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: inboxItem.id,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          automationId: automation.id,
          automationName: automation.name,
          repository: codingAgent.repository,
          workspaceId: codingAgent.organizationId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          status: inboxItem.status,
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
          unread: unreadFor(userId),
        })
        .from(inboxItem)
        .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
        // The automation, its id as its name, is told only to an account that may read the automation itself.
        .leftJoin(
          automation,
          and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
        )
        .where(tasklessWaiting(userId))
        .orderBy(...LATEST_FIRST),
    ),
});

/** Where every item the account's read names stands, a task's or an agent's with no task. Note that the task is joined on the left, because an item with no task has none to join. */
const findWaitingStamps = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: StampRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select(stampColumns(userId))
        .from(inboxItem)
        .leftJoin(task, eq(task.id, inboxItem.taskId))
        .where(or(accountWaiting(userId), tasklessWaiting(userId)))
        .orderBy(...LATEST_FIRST),
    ),
});

/** One task holding items as the account's read lists it: how many, and when the latest changed. */
const TaskItemsRowSchema = Schema.Struct({
  taskId: Schema.String,
  items: Schema.Number,
  updatedAt: InstantColumnSchema,
});

/** When a task's latest item changed, which orders the tasks holding items. */
const LATEST_ITEM = max(inboxItem.updatedAt);

/**
 * Every task of the account's workspaces that holds an item, open or
 * settled, whichever member's agent posted it, the task whose item changed
 * latest first: those it has not archived, and the archived ones too where
 * `archived` asks.
 */
const findTasksWithItems = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, archived: Schema.Boolean }),
  Result: TaskItemsRowSchema,
  execute: ({ userId, archived }) =>
    Database.use((db) =>
      db
        .select({ taskId: inboxItem.taskId, items: count(), updatedAt: LATEST_ITEM })
        .from(inboxItem)
        .innerJoin(task, eq(task.id, inboxItem.taskId))
        .where(and(taskReachableBy(userId), archived ? undefined : isNull(task.archivedAt)))
        .groupBy(inboxItem.taskId)
        .orderBy(desc(LATEST_ITEM), desc(inboxItem.taskId)),
    ),
});

/** One automation holding items of its runs' agents with no task, as the account's read lists it; null for the agents no standing automation names. */
const AutomationItemsRowSchema = Schema.Struct({
  automationId: Schema.NullOr(Schema.String),
  items: Schema.Number,
  updatedAt: InstantColumnSchema,
});

/**
 * Every automation whose runs' agents with no task hold an item in the
 * account's workspaces, open or settled, whichever member's agent posted
 * it, the automation whose item changed latest first, as the tasks are
 * listed; one the account may not read is listed as none, beside the
 * agents no standing automation names.
 */
const findAutomationsWithItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: AutomationItemsRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ automationId: automation.id, items: count(), updatedAt: LATEST_ITEM })
        .from(inboxItem)
        .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
        // An automation the account may not read groups with the agents no standing automation names.
        .leftJoin(
          automation,
          and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
        )
        .where(and(isNull(inboxItem.taskId), itemReachableBy(userId)))
        .groupBy(automation.id)
        .orderBy(desc(LATEST_ITEM), desc(automation.id)),
    ),
});

/** The statements the account's read is subscribed to live: each part of its answer as a row of the wire's own shape, what waits in chat among them. */
export interface AccountInboxLiveStatements extends ChatWaitingLiveStatements {
  readonly items: LiveStatement;
  readonly planless: LiveStatement;
  readonly plans: LiveStatement;
  readonly automations: LiveStatement;
}

/**
 * What waits on the developer across the account, written for Neon Realtime:
 * the same rows, joins, and rule of who may read them as `accountWaitingItems`,
 * `accountTasklessItems`, `accountInboxTasks` with the archived tasks, and
 * `accountInboxAutomations`, each item unread or not for the account as they say it, and what waits in
 * chat as `chat-waiting.ts` reads it (`chatWaitingLiveStatements`), each
 * column under the key `account-inbox-wire.ts` reads it by and each instant
 * in epoch milliseconds, so a row decodes as the held read's entry does. The order is the reader's to keep, since Realtime keeps none.
 * None where a statement names a value Realtime cannot carry.
 */
export function accountInboxLiveStatements(
  userId: string,
): Option.Option<AccountInboxLiveStatements> {
  const items = queryBuilder
    .select(
      liveSelection(
        {
          id: inboxItem.id,
          planId: inboxItem.taskId,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          unread: unreadFor(userId),
        },
        { postedAt: inboxItem.postedAt, updatedAt: inboxItem.updatedAt },
      ),
    )
    .from(inboxItem)
    .innerJoin(task, eq(task.id, inboxItem.taskId))
    .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
    .where(accountWaiting(userId));
  const planless = queryBuilder
    .select(
      liveSelection(
        {
          id: inboxItem.id,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          automationId: automation.id,
          automationName: automation.name,
          repository: codingAgent.repository,
          workspaceId: codingAgent.organizationId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          unread: unreadFor(userId),
        },
        { postedAt: inboxItem.postedAt, updatedAt: inboxItem.updatedAt },
      ),
    )
    .from(inboxItem)
    .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
    .leftJoin(
      automation,
      and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
    )
    .where(tasklessWaiting(userId));
  const plans = queryBuilder
    .select({
      ...liveSelection({ planId: inboxItem.taskId }),
      items: LIVE_COUNT.as("items"),
      updatedAt: liveLatest(inboxItem.updatedAt).as("updatedAt"),
    })
    .from(inboxItem)
    .innerJoin(task, eq(task.id, inboxItem.taskId))
    // The archived tasks too, as the held read lists them to a desktop that asks with `archived=include`, which every desktop following live does.
    .where(taskReachableBy(userId))
    .groupBy(inboxItem.taskId);
  const automations = queryBuilder
    .select({
      ...liveSelection({ automationId: automation.id }),
      items: LIVE_COUNT.as("items"),
      updatedAt: liveLatest(inboxItem.updatedAt).as("updatedAt"),
    })
    .from(inboxItem)
    .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
    .leftJoin(
      automation,
      and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
    )
    .where(and(isNull(inboxItem.taskId), itemReachableBy(userId)))
    .groupBy(automation.id);
  return Option.zipWith(
    Option.all({
      items: liveStatementOf(items),
      planless: liveStatementOf(planless),
      plans: liveStatementOf(plans),
      automations: liveStatementOf(automations),
    }),
    chatWaitingLiveStatements(userId),
    (parts, chat) => ({ ...parts, ...chat }),
  );
}

/** The statement a plan's or an agent's inbox is subscribed to live: its open items and its latest settled ones, as one result. */
export interface ScopeInboxLiveStatements {
  readonly items: LiveStatement;
}

/**
 * A scope's items written for Neon Realtime: the same rows, joins, bound,
 * and rule of who may read them as `scopeItems` with `MAX_ITEMS_READ`, and
 * the same columns, each item's thread, files, and whether it is unread for
 * the reader among them, each
 * column under the key `live-wire.ts` reads it by and each instant in epoch
 * milliseconds. The open items and the latest settled ones are one
 * statement, so an item settling moves from one to the other in one change
 * rather than leaving the reader a moment holding neither. The order is the
 * reader's to keep, since Realtime keeps none.
 */
function scopeLiveStatements(scope: InboxScope): Option.Option<ScopeInboxLiveStatements> {
  const latestSettled = queryBuilder
    .select({ id: inboxItem.id })
    .from(inboxItem)
    .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
    .orderBy(...LATEST_FIRST)
    .limit(INBOX_BOUNDS.MAX_ITEMS_READ);
  return Option.map(
    liveStatementOf(
      queryBuilder
        .select(
          liveSelection(
            {
              id: inboxItem.id,
              agentId: inboxItem.agentId,
              key: inboxItem.key,
              revision: inboxItem.revision,
              version: inboxItem.version,
              title: inboxItem.title,
              blocks: inboxItem.blocks,
              response: inboxItem.response,
              needsReply: inboxItem.needsReply,
              status: inboxItem.status,
              startedBy: inboxItem.userId,
              startedByName: INBOX_ITEM_COLUMNS.startedByName,
              answer: inboxItem.answer,
              answerFiles: ANSWER_FILES,
              answeredBy: inboxItem.answeredBy,
              answeredByName: INBOX_ITEM_COLUMNS.answeredByName,
              closedReason: inboxItem.closedReason,
              messages: MESSAGES,
              settledAt: SETTLED_AT,
              unread: unreadFor(scope.userId),
            },
            { postedAt: inboxItem.postedAt, updatedAt: inboxItem.updatedAt },
          ),
        )
        .from(inboxItem)
        .where(
          and(
            inScope(scope),
            or(eq(inboxItem.status, INBOX_STATUS.OPEN), inArray(inboxItem.id, latestSettled)),
          ),
        ),
    ),
    (items) => ({ items }),
  );
}

/** One plan's inbox written for Neon Realtime, as `taskInboxItems` reads it. */
export function taskInboxLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<ScopeInboxLiveStatements> {
  return scopeLiveStatements({ userId, scope: INBOX_SCOPE.TASK, id: taskId });
}

/** One agent's inbox written for Neon Realtime, as `memberAgentInboxItems` reads it. */
export function memberAgentInboxLiveStatements(
  userId: string,
  agentId: string,
): Option.Option<ScopeInboxLiveStatements> {
  return scopeLiveStatements({ userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId });
}

/** The scope's items: every open one, then the latest settled ones up to the limit. */
function scopeItems(
  scope: InboxScope,
  settledLimit: number,
): InboxStoreEffect<readonly InboxItem[]> {
  return Effect.map(
    Effect.all([findOpenItems(scope), findSettledItems({ ...scope, limit: settledLimit })]),
    ([open, settled]) => [...open, ...settled].map((row) => storedItem(row).item),
  );
}

const findItem = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, itemId: Schema.String }),
  Result: InboxRowSchema,
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select(inboxColumns(userId))
        .from(inboxItem)
        .where(and(eq(inboxItem.id, itemId), itemReachableBy(userId))),
    ),
});

/** The item by its id alone, read for the reader named where the caller has reached it already. */
const findItemOf = SqlSchema.findOneOption({
  Request: Schema.Struct({ readerId: Schema.String, itemId: Schema.String }),
  Result: InboxRowSchema,
  execute: ({ readerId, itemId }) =>
    Database.use((db) =>
      db.select(inboxColumns(readerId)).from(inboxItem).where(eq(inboxItem.id, itemId)),
    ),
});

/** The account, task, and workspace an item stands under, which its attachments are written under too. */
const findItemScope = SqlSchema.findOne({
  Request: Schema.Struct({ itemId: Schema.String }),
  Result: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.NullOr(Schema.String),
    organizationId: Schema.String,
  }),
  execute: ({ itemId }) =>
    Database.use((db) =>
      db
        .select({
          userId: inboxItem.userId,
          taskId: inboxItem.taskId,
          organizationId: inboxItem.organizationId,
        })
        .from(inboxItem)
        .where(eq(inboxItem.id, itemId)),
    ),
});

/** The item's scope, read where the caller has just written the item, so a missing row is a broken contract. */
function itemScope(request: { readonly itemId: string }) {
  return findItemScope(request).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
}

/** A marker's column as the row an insert would have written, which an upsert's update takes. */
function excluded(column: AnyPgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

/**
 * A read written over a marker that stands: read through the later of the
 * two changes and no longer marked unread. Note that it never moves a
 * marker back, because the change a read selected may be older than one a
 * write of the member's own, such as their answer, recorded while the read
 * waited on the marker's lock.
 */
const READ_ON = {
  readThrough: sql`greatest(${inboxItemRead.readThrough}, ${excluded(inboxItemRead.readThrough)})`,
  markedUnread: false,
};

/** Whether a read moves the marker that stands: it was marked unread, or the read reaches a later change than it had read through. */
const READ_MOVES = sql`${inboxItemRead.markedUnread} or ${inboxItemRead.readThrough} is null or ${inboxItemRead.readThrough} < ${excluded(inboxItemRead.readThrough)}`;

const ReaderItemSchema = Schema.Struct({ userId: Schema.String, itemId: Schema.String });

const MarkedSchema = Schema.Struct({ itemId: Schema.String });

/**
 * The member's marker on the item read through its last change, where the
 * account reaches the item; nothing where the marker already read through
 * that change or a later one and was not marked unread, so a read already
 * standing writes no row.
 */
const upsertRead = SqlSchema.findOneOption({
  Request: ReaderItemSchema,
  Result: MarkedSchema,
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .insert(inboxItemRead)
        .select(
          db
            .select({
              itemId: inboxItem.id,
              userId: sql<string>`${userId}::text`.as(inboxItemRead.userId.name),
              readThrough: inboxItem.updatedAt,
              markedUnread: sql<boolean>`false`.as(inboxItemRead.markedUnread.name),
            })
            .from(inboxItem)
            .where(and(eq(inboxItem.id, itemId), itemReachableBy(userId))),
        )
        .onConflictDoUpdate({
          target: [inboxItemRead.itemId, inboxItemRead.userId],
          set: READ_ON,
          setWhere: READ_MOVES,
        })
        .returning({ itemId: inboxItemRead.itemId }),
    ),
});

/** The member's marker on the item marked unread, where the account reaches the item; nothing where it stands marked already. */
const upsertUnread = SqlSchema.findOneOption({
  Request: ReaderItemSchema,
  Result: MarkedSchema,
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .insert(inboxItemRead)
        .select(
          db
            .select({
              itemId: inboxItem.id,
              userId: sql<string>`${userId}::text`.as(inboxItemRead.userId.name),
              markedUnread: sql<boolean>`true`.as(inboxItemRead.markedUnread.name),
            })
            .from(inboxItem)
            .where(and(eq(inboxItem.id, itemId), itemReachableBy(userId))),
        )
        .onConflictDoUpdate({
          target: [inboxItemRead.itemId, inboxItemRead.userId],
          set: { markedUnread: true },
          setWhere: sql`not ${inboxItemRead.markedUnread}`,
        })
        .returning({ itemId: inboxItemRead.itemId }),
    ),
});

/** The item's id, where the account reaches it. */
const findReachedItem = SqlSchema.findOneOption({
  Request: ReaderItemSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select({ id: inboxItem.id })
        .from(inboxItem)
        .where(and(eq(inboxItem.id, itemId), itemReachableBy(userId))),
    ),
});

/**
 * The items the account's Inbox lists, open or settled, whichever member's
 * agent posted each: those on the tasks of its workspaces it has not
 * archived, and those of agents with no task in its workspaces. Note that
 * the task is joined on the left, because an item with no task has none.
 */
function inboxListed(userId: string) {
  return or(
    and(taskReachableBy(userId), isNull(task.archivedAt)),
    and(isNull(inboxItem.taskId), itemReachableBy(userId)),
  );
}

/** Every item the account's Inbox lists that is unread for it, in the one workspace named or in all of them, marked read through its last change: the markers moved, which leaves out one a write of the member's own moved further meanwhile. */
const upsertAllRead = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, workspaceId: Schema.NullOr(Schema.String) }),
  Result: MarkedSchema,
  execute: ({ userId, workspaceId }) =>
    Database.use((db) =>
      db
        .insert(inboxItemRead)
        .select(
          db
            .select({
              itemId: inboxItem.id,
              userId: sql<string>`${userId}::text`.as(inboxItemRead.userId.name),
              readThrough: inboxItem.updatedAt,
              markedUnread: sql<boolean>`false`.as(inboxItemRead.markedUnread.name),
            })
            .from(inboxItem)
            .leftJoin(task, eq(task.id, inboxItem.taskId))
            .where(
              and(
                inboxListed(userId),
                workspaceId === null ? undefined : eq(inboxItem.organizationId, workspaceId),
                unreadFor(userId),
              ),
            ),
        )
        .onConflictDoUpdate({
          target: [inboxItemRead.itemId, inboxItemRead.userId],
          set: READ_ON,
          setWhere: READ_MOVES,
        })
        .returning({ itemId: inboxItemRead.itemId }),
    ),
});

/**
 * The answer written on the item where it stands open, at the revision
 * named or holding open the ask named, and no ask held open once it is;
 * its id, or nothing where it does not stand so.
 */
const answerItem = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    revision: Schema.NullOr(Schema.Number),
    askId: Schema.NullOr(Schema.String),
    answer: inboxReplySchema,
    answerKey: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, itemId, revision, askId, answer, answerKey, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.ANSWERED,
          answer,
          answerKey,
          answeredBy: userId,
          settledAt: now,
          updatedAt: now,
          openAskMessageId: null,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemReachableBy(userId),
            revision === null ? undefined : eq(inboxItem.revision, revision),
            askId === null ? undefined : eq(inboxItem.openAskMessageId, askId),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

/** The item as the reader named reads it, by its id alone, where the caller has just written it, so a missing row is a broken contract. */
function itemAsWritten(readerId: string, itemId: string): InboxStoreEffect<InboxItem> {
  return findItemOf({ readerId, itemId }).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.catchTag("NoSuchElementError", Effect.die),
    Effect.map((row) => storedItem(row).item),
  );
}

/** The message written, or the database breaking its contract where a message that names no key found one standing under it. */
function writtenMessage(
  message: typeof MessageWriteSchema.Type,
): InboxStoreEffect<{ readonly id: string }> {
  return insertMessage(message).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.catchTag("NoSuchElementError", Effect.die),
  );
}

/** A link's label as Markdown's link text, its brackets and backslashes escaped so the label stays the text. */
function linkText(label: string): string {
  return label.replace(/[\\[\]]/gu, (mark) => `\\${mark}`);
}

/** A link's address as Markdown's link destination, a parenthesis in it escaped as the URL's own, so the destination ends where it should. */
function linkDestination(url: string): string {
  return url.replaceAll("(", "%28").replaceAll(")", "%29");
}

/** The lines a code block points at as their GitHub page at the commit, which a message's words draw, standing alone, as those lines' card. */
function codeAddress(block: Extract<InboxBlock, { type: typeof INBOX_BLOCK.CODE }>): string {
  const path = block.path.split("/").map(encodeURIComponent).join("/");
  const lines =
    block.endLine > block.startLine
      ? `#L${block.startLine}-L${block.endLine}`
      : `#L${block.startLine}`;
  return `https://github.com/${block.repo}/blob/${block.sha}/${path}${lines}`;
}

/** The address a picture of the item's is written by in a message's words, by the picture's id. */
type PictureAddress = (pictureId: string) => string;

/** One block as a paragraph of a message's Markdown: its words, a link on its own line, a code block's lines by their address, or a picture by its own. */
function blockParagraph(block: InboxBlock, addressOf: PictureAddress): string {
  switch (block.type) {
    case INBOX_BLOCK.MARKDOWN:
      return block.text;
    case INBOX_BLOCK.LINK:
      return `[${linkText(block.label)}](${linkDestination(block.url)})`;
    case INBOX_BLOCK.CODE:
      return codeAddress(block);
    case INBOX_BLOCK.IMAGE:
      return taskPictureMarkdown(addressOf(block.attachmentId), block.alt);
  }
}

/** A post's blocks as its message's words: each block a paragraph of its own, in order. */
function bodyOfBlocks(blocks: readonly InboxBlock[], addressOf: PictureAddress): string {
  return blocks.map((block) => blockParagraph(block, addressOf)).join("\n\n");
}

/**
 * A picture in a message's words, `![alt](destination`, its opening
 * unescaped: the alt text the first group, the destination, bare or in
 * angle brackets, the second; each bounded, so the scan stays linear.
 */
const PICTURE_IN_WORDS =
  /(?<!\\)!\[((?:\\.|[^[\]\\\n]){0,1000})\]\([ \t]*(<[^<>\n]{1,1024}>|[^\s()<>]{1,1024})/gu;

/** A line that is one picture alone, its caption in quotes where it has one: alt text the first group, destination the second. */
const PICTURE_LINE =
  /^[ \t]*!\[((?:\\.|[^[\]\\\n]){0,1000})\]\([ \t]*(<[^<>\n]{1,1024}>|[^\s()<>]{1,1024})(?:[ \t]+"(?:\\.|[^"\\\n]){0,1000}")?[ \t]*\)[ \t]*$/u;

/** A picture's destination as the path or address it names, out of its angle brackets. */
function destinationOf(destination: string): string {
  return destination.startsWith("<") ? destination.slice(1, -1) : destination;
}

/**
 * The agent's words with each picture's path written as the address of the
 * file it was kept as, by the picture's id; a picture standing in code, or
 * naming a path no picture was handed in for, stands as written.
 */
function withPictureAddresses(
  body: string,
  pictureOfPath: (path: string) => string | undefined,
  addressOf: PictureAddress,
): string {
  return body.replace(
    PICTURE_IN_WORDS,
    (whole: string, _alt: string, destination: string, offset: number) => {
      const id = insideCode(body, offset) ? undefined : pictureOfPath(destinationOf(destination));
      if (id === undefined) return whole;
      return `${whole.slice(0, whole.length - destination.length)}${addressOf(id)}`;
    },
  );
}

/** A line that is one picture handed in alone as the image block a desktop before version 5 draws it as; nothing for any other line, or a picture whose alt text an image block cannot carry. */
function pictureBlock(
  line: string,
  pictureOfPath: (path: string) => string | undefined,
): InboxBlock | undefined {
  const [, alt = "", destination = ""] = PICTURE_LINE.exec(line) ?? [];
  const attachmentId = pictureOfPath(destinationOf(destination));
  const words = alt.replace(/\\(.)/gu, "$1").replace(/\s+/gu, " ").trim();
  if (attachmentId === undefined || words === "" || words.length > INBOX_BOUNDS.MAX_ALT_CHARS) {
    return undefined;
  }
  return { type: INBOX_BLOCK.IMAGE, attachmentId, alt: words };
}

/** Words as Markdown blocks: one, or as many as the bound cuts them into, and none for no words. */
function markdownBlocks(words: string): readonly InboxBlock[] {
  const blocks: InboxBlock[] = [];
  const text = words.trim();
  for (let at = 0; at < text.length; at += INBOX_BOUNDS.MAX_MARKDOWN_CHARS) {
    const part = text.slice(at, at + INBOX_BOUNDS.MAX_MARKDOWN_CHARS);
    if (part.trim() !== "") blocks.push({ type: INBOX_BLOCK.MARKDOWN, text: part });
  }
  return blocks;
}

/**
 * The item closed by the member without an answer where it is open at the
 * revision named, under the key their client sent the close with, kept
 * where an answer's is, so a close sent again finds the one it made and a
 * close taken back finds its own, and no ask held open; its id, or nothing
 * where it is not open there.
 */
const memberCloseItem = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    revision: Schema.Number,
    closeKey: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, itemId, revision, closeKey, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.CLOSED,
          answerKey: closeKey,
          closedBy: userId,
          closedReason: null,
          settledAt: now,
          updatedAt: now,
          openAskMessageId: null,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemReachableBy(userId),
            eq(inboxItem.revision, revision),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

/**
 * A message's words as the blocks an item shows a desktop before version
 * 5: each line that is one picture handed in alone an image block of its
 * own, and the words between them Markdown blocks. Note that a line in
 * code is words, so no fence is cut in two.
 */
function blocksOfBody(
  body: string,
  pictureOfPath: (path: string) => string | undefined,
): readonly InboxBlock[] {
  const blocks: InboxBlock[] = [];
  let words: string[] = [];
  let at = 0;
  for (const line of body.split("\n")) {
    const picture = insideCode(body, at) ? undefined : pictureBlock(line, pictureOfPath);
    at += line.length + 1;
    if (picture === undefined) {
      words.push(line);
      continue;
    }
    blocks.push(...markdownBlocks(words.join("\n")), picture);
    words = [];
  }
  return [...blocks, ...markdownBlocks(words.join("\n"))];
}

/**
 * The blocks a post from version 5 shows a desktop before it: its words,
 * then a `do` ask's steps as a numbered list, since the to-do such a
 * desktop draws for it names none of its own.
 */
function viewBlocks(
  body: string,
  ask: InboxAsk | undefined,
  pictureOfPath: (path: string) => string | undefined,
): readonly InboxBlock[] {
  const blocks = blocksOfBody(body, pictureOfPath);
  const steps = ask?.type === INBOX_ASK.DO ? ask.steps : [];
  if (steps.length === 0) return blocks;
  const list = steps.map((step, at) => `${at + 1}. ${step}`).join("\n");
  return [...blocks, { type: INBOX_BLOCK.MARKDOWN, text: list }];
}

/** What a post writes on the item for a desktop before version 5: the title, the blocks, and the response that stand for what it asks, and whether the agent is to hear the answer. */
interface PostView {
  readonly title: string;
  readonly blocks: readonly InboxBlock[];
  readonly response: InboxResponse;
  readonly needsReply: boolean;
}

/** One picture a post keeps as a file of its message: the id its blocks and words name it by, its file's own name, its type, and its bytes. */
interface PostPicture extends InboxNamedImage {
  readonly id: string;
}

/** One picture the agent's words name by its path in the agent's sandbox, as the caller read it there: the path as written, its file's own name, its type, and its bytes. */
interface InboxBodyPicture extends InboxNamedImage {
  readonly path: string;
}

/** A post as the store writes it, whichever tool posted it: the item's key, its view, the words of the agent's message, the ask the message ends with, and the message's pictures. */
interface PostWrite {
  readonly key: string;
  readonly view: PostView;
  /** The message's words, its pictures written by the addresses the item gives them. */
  readonly body: (addressOf: PictureAddress) => string;
  readonly ask: InboxAsk | undefined;
  readonly pictures: readonly PostPicture[];
}

/** The agent's workspace as its locked row names it: its id, which the item's rows are written under, and the step its links name it by. */
interface LockedWorkspace {
  readonly organizationId: string;
  readonly workspaceStep: string;
}

/** The item as its link names it: under the agent's task, or under the agent where it has none. */
function itemPlace(agent: InboxAgent, itemId: string): InboxItemPlace {
  return agent.taskId === null
    ? { kind: LINK_PLACE.INBOX_ITEM, agentId: agent.agentId, itemId }
    : { kind: LINK_PLACE.INBOX_ITEM, planId: agent.taskId, itemId };
}

/** The address each picture of the item is written by in a message's words (`inbox-attachment-link.ts`). */
function pictureAddressOf(
  agent: InboxAgent,
  workspace: LockedWorkspace,
  itemId: string,
): PictureAddress {
  const place = itemPlace(agent, itemId);
  return (pictureId) => inboxAttachmentAddress(place, pictureId, workspace.workspaceStep);
}

/** Pictures handed in by the paths the agent's words name them by, as a post keeps them: each under an id minted for it, and the id of the first each path names. */
interface PicturesByPath {
  readonly kept: readonly PostPicture[];
  readonly idOf: (path: string) => string | undefined;
}

/** The pictures handed in, each under an id minted for it, found by the path the agent's words name it by. */
function picturesByPath(pictures: readonly InboxBodyPicture[]): PicturesByPath {
  const kept = pictures.map(({ path: _path, ...picture }) => ({ ...picture, id: randomUUID() }));
  const ids = new Map<string, string>();
  pictures.forEach((picture, at) => {
    const id = kept[at]?.id;
    if (id !== undefined && !ids.has(picture.path)) ids.set(picture.path, id);
  });
  return { kept, idOf: (path) => ids.get(path) };
}

/**
 * The columns a post writes on the item. An ask opens the item, the view
 * standing for it; a post that asks nothing waits on nobody, so the item
 * stands to a desktop before version 5 as a note already settled, with no
 * blocks, since its message, which such a desktop draws, carries its words.
 */
function postColumns(view: PostView, ask: InboxAsk | undefined, now: Date) {
  if (ask !== undefined) return { ...view, status: INBOX_STATUS.OPEN, settledAt: null };
  return {
    title: view.title,
    blocks: [],
    response: { type: INBOX_RESPONSE.NONE },
    needsReply: false,
    status: INBOX_STATUS.ANSWERED,
    settledAt: now,
  } as const;
}

/**
 * A post written on the agent's locked row's workspace: the item under its
 * key written as the view of what it asks, the agent's message with the
 * post's words and its ask written on the thread, every ask the thread held
 * open before replaced, the new one held open, the message's pictures kept
 * as its files, and the item's own files from before deleted; the item as
 * its agent's starter then reads it.
 */
function keepPost(
  agent: InboxAgent,
  workspace: LockedWorkspace,
  post: PostWrite,
  now: Date,
): InboxStoreEffect<InboxItem> {
  const { organizationId } = workspace;
  return Effect.gen(function* () {
    const { id: itemId } = yield* upsertItem({
      ...agent,
      organizationId,
      key: post.key,
      ...postColumns(post.view, post.ask, now),
      now,
    }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
    const ask = post.ask === undefined ? null : { ...post.ask, status: INBOX_ASK_STATUS.OPEN };
    const message = yield* writtenMessage({
      itemId,
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      userId: null,
      text: post.body(pictureAddressOf(agent, workspace, itemId)),
      ask,
      answers: null,
      clientKey: null,
      now,
    });
    yield* settleOpenAsks({
      itemId,
      except: message.id,
      status: INBOX_ASK_STATUS.REPLACED,
      withdrawnReason: null,
    });
    if (ask !== null) yield* holdAsk({ itemId, messageId: message.id });
    yield* Effect.forEach(post.pictures, (picture, position) =>
      insertMessageFile({
        id: picture.id,
        userId: agent.userId,
        taskId: agent.taskId,
        organizationId,
        itemId,
        messageId: message.id,
        name: picture.name,
        position,
        contentType: picture.contentType,
        bytes: picture.bytes,
        now,
      }),
    );
    yield* deleteItemFiles({ itemId });
    return yield* itemAsWritten(agent.userId, itemId);
  });
}

/** The agent's open items besides the key's against the bound: whether one more may stand open. */
function roomToAsk(agent: InboxAgent, key: string): InboxStoreEffect<boolean> {
  return countOpenBesides({ ...agent, key }).pipe(
    // A count that returned no row is the database breaking its own contract, not an outcome.
    Effect.catchTag("NoSuchElementError", Effect.die),
    Effect.map(({ open }) => open < INBOX_BOUNDS.MAX_OPEN_PER_AGENT),
  );
}

/** A file's own name from the path the agent named it by in its sandbox. */
function fileName(path: string): string {
  return posix.basename(path) || path;
}

/**
 * The agent's post written, as the tool before version 5 posts one: a new
 * item under its key, or the one standing under it written again, as
 * `keepPost` writes one. The message's words are the blocks in order, and
 * its ask is the one the response stands for; an acknowledgement asks
 * nothing, so its item waits on nobody. Refused where the agent would hold
 * more open items than the bound, or is no longer the account's. The
 * pictures are the post's image blocks' bytes in the blocks' own order, one
 * each, read by the caller; each is kept as a file of the post's message
 * under an id minted here, which its block names. Note that the post's own
 * key is not counted, because writing it again opens no second item.
 */
export function postInboxItem(
  agent: InboxAgent,
  post: InboxPost,
  images: readonly InboxImage[] = [],
): InboxStoreEffect<Result.Result<InboxItem, InboxPostRefusal>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockAgent(agent);
        if (Option.isNone(locked)) return Result.fail(INBOX_POST_REFUSAL.NO_AGENT);
        const ask = inboxResponseAsk(post.response);
        // A post that asks nothing waits on nobody, so it takes no place among the open items.
        if (ask !== undefined && !(yield* roomToAsk(agent, post.key))) {
          return Result.fail(INBOX_POST_REFUSAL.TOO_MANY_OPEN);
        }
        const now = yield* DateTime.nowAsDate;
        const posted = post.blocks ?? [];
        const names = posted.flatMap((block) =>
          block.type === INBOX_BLOCK.IMAGE ? [fileName(block.path)] : [],
        );
        const pictures = yield* Effect.sync(() =>
          images.map((image, at) => ({ ...image, name: names[at] ?? "", id: randomUUID() })),
        );
        const blocks = storedBlocks(
          posted,
          pictures.map((picture) => picture.id),
        );
        const view = {
          title: post.title,
          blocks,
          response: post.response,
          needsReply: post.needsReply ?? true,
        };
        const body = (addressOf: PictureAddress) => bodyOfBlocks(blocks, addressOf);
        const write = { key: post.key, view, body, ask, pictures };
        return Result.succeed(yield* keepPost(agent, locked.value, write, now));
      }),
    ),
  );
}

/** A post as the tool from version 5 writes one: the item's key and title, the agent's words in Markdown, the ask they end with, if any, and whether the agent is to hear the answer. */
interface InboxThreadPost {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly ask?: InboxAsk | undefined;
  readonly needsReply?: boolean | undefined;
}

/**
 * The agent's words that ask nothing written as its message on the thread
 * of its item standing under the key, as its reply is, with the pictures
 * they name kept as the message's files and written by their addresses;
 * the item as its agent's starter then reads it.
 */
function followUp(
  agent: InboxAgent,
  workspace: LockedWorkspace,
  itemId: string,
  post: InboxThreadPost,
  pictures: readonly InboxBodyPicture[],
): InboxStoreEffect<InboxItem> {
  return Effect.suspend(() => {
    const { kept, idOf } = picturesByPath(pictures);
    const text = withPictureAddresses(post.body, idOf, pictureAddressOf(agent, workspace, itemId));
    const writer = { author: INBOX_MESSAGE_AUTHOR.AGENT } as const;
    return writeInboxMessage(agent.userId, itemId, writer, text, kept);
  }).pipe(
    // The item was found under the lock on its agent, so a message that finds none is a broken contract.
    Effect.flatMap(Effect.fromOption),
    Effect.catchTag("NoSuchElementError", Effect.die),
    Effect.map((written) => written.item),
  );
}

/**
 * The agent's post written, as the tool from version 5 posts one: its
 * words in Markdown, and the ask they end with, if any. The pictures are
 * those the words name by their paths in the agent's sandbox, read by the
 * caller, each kept as a file of the agent's message under an id minted
 * here, its path in the words written as its address. A post that asks is
 * written as `keepPost` writes one, its view the words as blocks, each
 * picture standing alone on its line an image block, and the response
 * nearest its ask; it is refused where the agent would hold more open
 * items than the bound. A post that asks nothing is a message on the
 * thread of the item standing under its key, as the agent's reply is,
 * which moves nothing of the item but its last change; under a key with
 * no item it opens a thread that waits on nobody. Refused where the agent
 * is no longer the account's.
 */
export function postInboxThread(
  agent: InboxAgent,
  post: InboxThreadPost,
  pictures: readonly InboxBodyPicture[] = [],
): InboxStoreEffect<Result.Result<InboxItem, InboxPostRefusal>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockAgent(agent);
        if (Option.isNone(locked)) return Result.fail(INBOX_POST_REFUSAL.NO_AGENT);
        const standing = yield* findAgentItem({ ...agent, key: post.key });
        if (post.ask === undefined && Option.isSome(standing)) {
          return Result.succeed(
            yield* followUp(agent, locked.value, standing.value.id, post, pictures),
          );
        }
        if (post.ask !== undefined && !(yield* roomToAsk(agent, post.key))) {
          return Result.fail(INBOX_POST_REFUSAL.TOO_MANY_OPEN);
        }
        const now = yield* DateTime.nowAsDate;
        const { kept, idOf } = yield* Effect.sync(() => picturesByPath(pictures));
        const view = {
          title: post.title,
          blocks: viewBlocks(post.body, post.ask, idOf),
          response:
            post.ask === undefined ? { type: INBOX_RESPONSE.NONE } : inboxAskResponse(post.ask),
          needsReply: post.needsReply ?? true,
        };
        const body = (addressOf: PictureAddress) =>
          withPictureAddresses(post.body, idOf, addressOf);
        const write = { key: post.key, view, body, ask: post.ask, pictures: kept };
        return Result.succeed(yield* keepPost(agent, locked.value, write, now));
      }),
    ),
  );
}

/** The picture or the answer's file, where it is the item's: its type and its bytes; nothing where the account reaches no such item or the item carries no such attachment. */
export function readInboxAttachment(
  userId: string,
  itemId: string,
  attachmentId: string,
): InboxStoreEffect<Option.Option<InboxFile>> {
  return findAttachment({ userId, itemId, attachmentId });
}

/**
 * The agent's item under the key closed with why, its revision moved on,
 * and the ask it held open withdrawn with the same why; nothing where it
 * has none under the key.
 */
export function closeInboxItem(
  agent: Pick<InboxAgent, "userId" | "agentId">,
  key: string,
  reason: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const closed = yield* closeItem({ ...agent, key, reason, now });
        if (Option.isNone(closed)) return Option.none();
        const itemId = closed.value.id;
        yield* settleOpenAsks({
          itemId,
          except: null,
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: reason,
        });
        return Option.some(yield* itemAsWritten(agent.userId, itemId));
      }),
    ),
  );
}

/**
 * The agent's own items as its tools answer with them: every one still
 * open, then the latest settled ones, few enough that a tool's answer stays
 * a small part of the agent's context. Note that the open items are read
 * apart from the bound, so one the developer has yet to answer is never
 * dropped from what the agent holds.
 */
export function agentInboxItems(
  agent: Pick<InboxAgent, "userId" | "agentId">,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId: agent.userId, scope: INBOX_SCOPE.AGENT, id: agent.agentId },
    INBOX_BOUNDS.MAX_SETTLED_TOLD,
  );
}

/**
 * The task's inbox: every item still open, then the latest settled ones as
 * many as a read carries. Note that the open items are read apart from the
 * bound, because one left unanswered while many others changed must still
 * wait where the developer looks.
 */
export function taskInboxItems(
  userId: string,
  taskId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems({ userId, scope: INBOX_SCOPE.TASK, id: taskId }, INBOX_BOUNDS.MAX_ITEMS_READ);
}

/** One agent's items as any member of its workspace reads them, an agent with no task as much as one on a task: every open one, then the latest settled. */
export function memberAgentInboxItems(
  userId: string,
  agentId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId },
    INBOX_BOUNDS.MAX_ITEMS_READ,
  );
}

/** Where each of the agent's items stands, the same items `memberAgentInboxItems` reads and none of their words: what a held read compares between looks. */
export function memberAgentInboxStamps(
  userId: string,
  agentId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  return scopeStamps({ userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId });
}

/** Where each of the task's items stands, the same items `taskInboxItems` reads and none of their words: what a held read compares between looks. */
export function taskInboxStamps(
  userId: string,
  taskId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  return scopeStamps({ userId, scope: INBOX_SCOPE.TASK, id: taskId });
}

/** Where the scope's items stand: every open one, then the latest settled, as `scopeItems` reads them. */
function scopeStamps(scope: InboxScope): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(
    Effect.all([
      findOpenStamps(scope),
      findSettledStamps({ ...scope, limit: INBOX_BOUNDS.MAX_ITEMS_READ }),
    ]),
    ([open, settled]) =>
      [...open, ...settled].map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

/** The item, with the key its answer was taken under; nothing for one of a workspace the account is not in. */
export function readInboxItem(
  userId: string,
  itemId: string,
): InboxStoreEffect<Option.Option<StoredInboxItem>> {
  return Effect.map(findItem({ userId, itemId }), Option.map(storedItem));
}

/** The item's task, where it stands on one the account reaches and it is archived. */
const findArchivedItemTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, itemId: Schema.String }),
  Result: Schema.Struct({ taskId: Schema.String }),
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select({ taskId: task.id })
        .from(inboxItem)
        .innerJoin(task, eq(task.id, inboxItem.taskId))
        .where(and(eq(inboxItem.id, itemId), taskReachableBy(userId), isNotNull(task.archivedAt))),
    ),
});

/**
 * Whether the item stands on a task the account archived: put away with its
 * task, read but answered no longer until the task is brought back. An item
 * of an agent with no task, or one the account does not reach, is not.
 */
export function inboxItemArchived(userId: string, itemId: string): InboxStoreEffect<boolean> {
  return Effect.map(findArchivedItemTask({ userId, itemId }), Option.isSome);
}

/** Whether the marker's write found the item: it moved the marker, or the account reaches an item whose marker stood as asked already. */
function markerFound(
  marked: Option.Option<typeof MarkedSchema.Type>,
  request: typeof ReaderItemSchema.Type,
): InboxStoreEffect<boolean> {
  if (Option.isSome(marked)) return Effect.succeed(true);
  return Effect.map(findReachedItem(request), Option.isSome);
}

/**
 * The item marked read for the member, read through its last change and
 * no longer marked unread, which is what opening it does; whether the
 * account reaches the item. A read already standing writes nothing, so
 * marking an item read again is one statement and one lookup.
 */
export function markInboxItemRead(userId: string, itemId: string): InboxStoreEffect<boolean> {
  const request = { userId, itemId };
  return Effect.flatMap(upsertRead(request), (marked) => markerFound(marked, request));
}

/** The item marked unread for the member, standing so until they read it again, whatever changes meanwhile; whether the account reaches the item. */
export function markInboxItemUnread(userId: string, itemId: string): InboxStoreEffect<boolean> {
  const request = { userId, itemId };
  return Effect.flatMap(upsertUnread(request), (marked) => markerFound(marked, request));
}

/**
 * Every item the member's Inbox lists marked read for them, open or
 * settled, in the one workspace named or in every workspace of theirs
 * where none is: how many were unread. An item already read is not
 * written, and another member's markers are never touched.
 */
export function markInboxRead(
  userId: string,
  workspaceId: string | undefined,
): InboxStoreEffect<number> {
  return Effect.map(
    upsertAllRead({ userId, workspaceId: workspaceId ?? null }),
    (marked) => marked.length,
  );
}

/**
 * The answer taken back off the item it was taken on under the key,
 * opening it again and holding open again the ask the answer settled, where
 * one did; its id, or nothing where that answer no longer stands.
 */
const withdrawAnswer = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    answerKey: Schema.String,
    openAsk: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, itemId, answerKey, openAsk, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.OPEN,
          answer: null,
          answerKey: null,
          answeredBy: null,
          settledAt: null,
          updatedAt: now,
          openAskMessageId: openAsk,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemReachableBy(userId),
            eq(inboxItem.answerKey, answerKey),
            eq(inboxItem.status, INBOX_STATUS.ANSWERED),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

/**
 * The answer taken under the key withdrawn, where it still stands: the item
 * open again, the member's message that carried it deleted with its files,
 * and the ask it answered open again, or, for an answer that answered no
 * ask, its files deleted; nothing where it does not stand.
 */
export function withdrawInboxAnswer(
  userId: string,
  itemId: string,
  answerKey: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const answering = yield* findAnsweringMessage({ itemId, clientKey: answerKey });
        const openAsk = Option.isSome(answering) ? answering.value.answers.ask : null;
        const withdrawn = yield* withdrawAnswer({ userId, itemId, answerKey, openAsk, now });
        if (Option.isNone(withdrawn)) return Option.none();
        if (openAsk !== null) {
          yield* standAsk({
            messageId: openAsk,
            status: INBOX_ASK_STATUS.OPEN,
            withdrawnReason: null,
          });
          yield* deleteMessage({ itemId, clientKey: answerKey });
        }
        yield* deleteAnswerFiles({ itemId });
        // The answer taken back is the member's own, so it leaves the item read for them as the answer did.
        yield* upsertRead({ userId, itemId });
        return Option.map(yield* findItem({ userId, itemId }), (row) => storedItem(row).item);
      }),
    ),
  );
}

/**
 * The item closed by a member without an answer, at the revision named and
 * under the key their client sent the close with, where it is open there,
 * and the ask it held open withdrawn with no reason, which is how a
 * member's close reads on the thread; nothing where it is not open there.
 * The revision stays, as an answer's does. The close is the member's own,
 * so it leaves the item read for them, as an answer does; no message is
 * written for it.
 */
export function closeInboxItemAsMember(
  userId: string,
  itemId: string,
  revision: number,
  closeKey: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const closed = yield* memberCloseItem({ userId, itemId, revision, closeKey, now });
        if (Option.isNone(closed)) return Option.none();
        // Note that the reason is left out, because an agent's close always says why and a member's never does.
        yield* settleOpenAsks({
          itemId,
          except: null,
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: null,
        });
        yield* upsertRead({ userId, itemId });
        return Option.map(yield* findItem({ userId, itemId }), (row) => storedItem(row).item);
      }),
    ),
  );
}

/**
 * A member's close taken back off the item it was taken on under the key,
 * opening it again and holding open again the ask it withdrew, where it
 * withdrew one; its id, or nothing where that close no longer stands.
 */
const withdrawClose = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    closeKey: Schema.String,
    openAsk: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, itemId, closeKey, openAsk, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.OPEN,
          answerKey: null,
          closedBy: null,
          settledAt: null,
          updatedAt: now,
          openAskMessageId: openAsk,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemReachableBy(userId),
            eq(inboxItem.answerKey, closeKey),
            eq(inboxItem.status, INBOX_STATUS.CLOSED),
            // The agent's own close since, which always says why, is never opened by taking the member's back.
            isNull(inboxItem.closedReason),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

/** The item's latest message that asks, with its ask as it was kept. */
const findLatestAsk = SqlSchema.findOneOption({
  Request: Schema.Struct({ itemId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, ask: inboxReadAskSchema }),
  execute: ({ itemId }) =>
    Database.use((db) =>
      db
        .select({ id: inboxMessage.id, ask: inboxMessage.ask })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.itemId, itemId), isNotNull(inboxMessage.ask)))
        .orderBy(desc(inboxMessage.createdAt), desc(inboxMessage.id))
        .limit(1),
    ),
});

/**
 * The ask a member's close withdrew, by its message: the item's latest ask,
 * where it stands withdrawn with no reason. Note that no post can have
 * come since the close, because a post clears the key the close stands
 * under, so the latest ask is the one it withdrew.
 */
function askTheCloseWithdrew(itemId: string): InboxStoreEffect<string | null> {
  return Effect.map(findLatestAsk({ itemId }), (latest) =>
    Option.isSome(latest) &&
    latest.value.ask.status === INBOX_ASK_STATUS.WITHDRAWN &&
    latest.value.ask.withdrawnReason === undefined
      ? latest.value.id
      : null,
  );
}

/** The member's close taken under the key withdrawn, the item open again and the ask it withdrew open again, where it still stands; nothing where it does not. */
export function withdrawInboxClose(
  userId: string,
  itemId: string,
  closeKey: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const openAsk = yield* askTheCloseWithdrew(itemId);
        const withdrawn = yield* withdrawClose({ userId, itemId, closeKey, openAsk, now });
        if (Option.isNone(withdrawn)) return Option.none();
        if (openAsk !== null) {
          yield* standAsk({
            messageId: openAsk,
            status: INBOX_ASK_STATUS.OPEN,
            withdrawnReason: null,
          });
        }
        yield* upsertRead({ userId, itemId });
        return Option.map(yield* findItem({ userId, itemId }), (row) => storedItem(row).item);
      }),
    ),
  );
}

/** A file's base64 as the bytes it spells; the wire held it to standard padded base64 already. */
function bytesOf(file: CodingAgentAttachment): Uint8Array {
  return new Uint8Array(Buffer.from(file.data, "base64"));
}

/** An ask as a message keeps it without where it stands, where this build knows its type; nothing for a type a newer deployment wrote. */
function knownAsk(ask: InboxReadAsk): InboxAsk | undefined {
  const { status: _status, withdrawnReason: _reason, ...kept } = ask;
  return Schema.is(inboxAskSchema)(kept) ? kept : undefined;
}

/** A note bounded as an answer's note on the item, which a desktop before version 5 reads it as; words past the bound end in an ellipsis. */
function boundedNote(words: string): string {
  const max = INBOX_BOUNDS.MAX_NOTE_CHARS;
  return words.length <= max ? words : `${words.slice(0, max - 1)}…`;
}

/** The reply a desktop before version 5 reads a pick of an approval's option as. */
const APPROVAL_REPLY: ReadonlyMap<string, InboxReply["reply"]> = new Map([
  [INBOX_APPROVAL_OPTION.APPROVE, INBOX_REPLY.APPROVED],
  [INBOX_APPROVAL_OPTION.DECLINE, INBOX_REPLY.DECLINED],
]);

/**
 * The answer as the item carries it for a desktop before version 5: how
 * they answered, the options picked, the values filled, and the answering
 * message's words as the note. Note that a pick of Approve or Decline on an
 * item that asked an approval reads as Approved or Declined, because that
 * is how such a desktop asked it.
 */
function answerView(response: InboxResponse, answers: InboxAnswers, words: string): InboxReply {
  const [picked = ""] = answers.choices ?? [];
  const approval =
    response.type === INBOX_RESPONSE.APPROVAL && answers.reply === INBOX_REPLY.CHOSE
      ? APPROVAL_REPLY.get(picked)
      : undefined;
  const note = words.trim() === "" ? undefined : boundedNote(words);
  if (approval !== undefined)
    return { reply: approval, ...(note === undefined ? undefined : { note }) };
  return {
    reply: answers.reply,
    ...(answers.choices === undefined ? undefined : { choices: answers.choices }),
    ...(answers.values === undefined ? undefined : { values: answers.values }),
    ...(note === undefined ? undefined : { note }),
  };
}

/** The answer's own words, its files, and the ask it settles, by message, as the answer's write keeps them. */
interface AnswerWrite {
  readonly userId: string;
  readonly itemId: string;
  readonly answerKey: string;
  readonly words: string;
  readonly files: readonly CodingAgentAttachment[];
  /** The message whose ask the answer settles; nothing for an item that held none open. */
  readonly askId: string | undefined;
  /** The answer to the ask as a member's message carries it; nothing for an answer that answers no ask. */
  readonly answers: InboxAnswers | undefined;
  readonly now: Date;
}

/**
 * The member's message that carries an answer, written under the answer's
 * key; the caller found no message under it first, so one standing there
 * now is a race that rolls the answer back rather than leaving it unheard.
 */
function answeringMessage(
  message: typeof MessageWriteSchema.Type,
): InboxStoreEffect<Option.Option<{ readonly id: string }>> {
  return insertMessage(message).pipe(
    Effect.flatMap((written) =>
      Option.isSome(written)
        ? Effect.succeed(written)
        : Effect.die(new Error("a message took the answer's key while it was written")),
    ),
  );
}

/**
 * What an answer taken writes beside the item: the ask it settles stood
 * answered, and the member's message carrying the answer, under the
 * answer's key, with the answer's words and its files; or, for an answer to
 * an item that held no ask open, as one from before version 5 did, the
 * files kept as the item's answer files, the item's answer saying the rest.
 */
function keepAnswer(write: AnswerWrite): InboxStoreEffect<void> {
  return Effect.gen(function* () {
    const { itemId, now } = write;
    if (write.askId !== undefined) {
      yield* standAsk({
        messageId: write.askId,
        status: INBOX_ASK_STATUS.ANSWERED,
        withdrawnReason: null,
      });
    }
    const written =
      write.answers === undefined
        ? Option.none()
        : yield* answeringMessage({
            itemId,
            author: INBOX_MESSAGE_AUTHOR.MEMBER,
            userId: write.userId,
            text: write.words,
            ask: null,
            answers: write.answers,
            clientKey: write.answerKey,
            now,
          });
    if (write.files.length === 0) return;
    const scope = yield* itemScope({ itemId });
    yield* Effect.forEach(write.files, (file, position) => {
      const kept = {
        ...scope,
        itemId,
        name: file.name,
        position,
        contentType: file.mediaType,
        bytes: bytesOf(file),
        now,
      };
      return Option.isSome(written)
        ? insertMessageFile({ ...kept, messageId: written.value.id })
        : insertAnswerFile(kept);
    });
  });
}

/** Whether a message of the item's thread stands under the key. */
function keyTaken(itemId: string, clientKey: string): InboxStoreEffect<boolean> {
  return Effect.map(findKeyedMessage({ itemId, clientKey }), Option.isSome);
}

/**
 * The developer's answer taken on the item at the revision named, under
 * the key the client sent it with, as a desktop before version 5 answers,
 * in one write: where the item holds an ask open, the ask settled and the
 * answer written as the member's message that answers it, the note its
 * words and the files its own; for an item from before version 5, which
 * holds none, the files kept as the item's answer files. Nothing, and no
 * file kept, where the item is no longer open at that revision. Note that
 * the revision stays, because only what the agent asks moves it.
 */
export function answerInboxItem(
  userId: string,
  itemId: string,
  revision: number,
  answer: InboxReply,
  answerKey: string,
  files: readonly CodingAgentAttachment[] = [],
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        // A key another message of the thread holds would leave the answer with no message to carry it.
        if (yield* keyTaken(itemId, answerKey)) return Option.none();
        const asking = yield* findOpenAsk({ userId, itemId });
        const answered = yield* answerItem({
          userId,
          itemId,
          revision,
          askId: null,
          answer,
          answerKey,
          now,
        });
        if (Option.isNone(answered)) return Option.none();
        // The member's own answer leaves the item read for them, and unread for every other member.
        yield* upsertRead({ userId, itemId });
        const held = Option.getOrUndefined(asking);
        // Note that an ask a post from before version 5 posted over is not what this answer answers, so it stands replaced and the answer is the item's own.
        const current =
          held !== undefined && askStillAsked(held.response, held.ask) ? held : undefined;
        if (held !== undefined && current === undefined) {
          yield* standAsk({
            messageId: held.id,
            status: INBOX_ASK_STATUS.REPLACED,
            withdrawnReason: null,
          });
        }
        const ask = current === undefined ? undefined : knownAsk(current.ask);
        const answers =
          current === undefined || ask === undefined
            ? undefined
            : inboxReplyAnswers({ id: current.id, ask }, answer);
        const words = answer.note ?? "";
        const askId = current?.id;
        yield* keepAnswer({ userId, itemId, answerKey, words, files, askId, answers, now });
        return Option.map(yield* findItem({ userId, itemId }), (row) => storedItem(row).item);
      }),
    ),
  );
}

/** What an answer to an ask came to. */
export const INBOX_ASK_ANSWER = {
  /** This write took it. */
  TAKEN: "taken",
  /** An answer under the same key stands on the item already. */
  REPEATED: "repeated",
  /** The ask is no longer the item's open one: answered, replaced, or withdrawn. */
  NOT_OPEN: "not-open",
  /** The answer does not fit the ask; nothing was written. */
  REFUSED: "refused",
} as const;

type InboxAskAnswer = (typeof INBOX_ASK_ANSWER)[keyof typeof INBOX_ASK_ANSWER];

/** What an answer to an ask came to: the item as it then stands, what this write did, and why it was refused, where it was. */
interface InboxAskAnswered {
  readonly item: InboxItem;
  readonly outcome: InboxAskAnswer;
  readonly refusal?: string;
}

/**
 * A member's answer to the ask the item holds open, named by its message,
 * as a desktop from version 5 answers: checked against the ask
 * (`inboxAnswersRefusal`), then written in one write as the member's
 * message carrying it under the client's key, with its words and files,
 * the ask stood answered, and the item answered with the answer's view for
 * a desktop before version 5; nothing where the account reaches no such
 * item. An answer sent again under the key it was taken by finds it taken;
 * an ask the item no longer holds open takes none.
 */
export function answerInboxAsk(
  userId: string,
  itemId: string,
  sent: {
    readonly answers: InboxAnswers;
    readonly text: string;
    readonly clientKey: string;
    readonly files?: readonly CodingAgentAttachment[] | undefined;
  },
): InboxStoreEffect<Option.Option<InboxAskAnswered>> {
  const files = sent.files ?? [];
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const found = yield* findItem({ userId, itemId });
        if (Option.isNone(found)) return Option.none();
        const standing = (outcome: InboxAskAnswer, refusal?: string) =>
          Option.some({
            item: storedItem(found.value).item,
            outcome,
            ...(refusal === undefined ? undefined : { refusal }),
          });
        if (found.value.answerKey === sent.clientKey) return standing(INBOX_ASK_ANSWER.REPEATED);
        if (yield* keyTaken(itemId, sent.clientKey)) {
          return standing(INBOX_ASK_ANSWER.REFUSED, "The key names another message of the thread.");
        }
        const asking = yield* findOpenAsk({ userId, itemId });
        if (
          Option.isNone(asking) ||
          asking.value.id !== sent.answers.ask ||
          !askStillAsked(asking.value.response, asking.value.ask)
        ) {
          return standing(INBOX_ASK_ANSWER.NOT_OPEN);
        }
        const ask = knownAsk(asking.value.ask);
        const refusal =
          ask === undefined
            ? "The ask is one this Luke does not know."
            : inboxAnswersRefusal(ask, sent.answers, sent.text, files);
        if (refusal !== undefined) return standing(INBOX_ASK_ANSWER.REFUSED, refusal);
        const now = yield* DateTime.nowAsDate;
        const answered = yield* answerItem({
          userId,
          itemId,
          revision: found.value.revision,
          askId: asking.value.id,
          answer: answerView(found.value.response, sent.answers, sent.text),
          answerKey: sent.clientKey,
          now,
        });
        if (Option.isNone(answered)) return standing(INBOX_ASK_ANSWER.NOT_OPEN);
        // The member's own answer leaves the item read for them, and unread for every other member.
        yield* upsertRead({ userId, itemId });
        yield* keepAnswer({
          userId,
          itemId,
          answerKey: sent.clientKey,
          words: sent.text,
          files,
          askId: asking.value.id,
          answers: sent.answers,
          now,
        });
        const item = yield* itemAsWritten(userId, itemId);
        return Option.some({ item, outcome: INBOX_ASK_ANSWER.TAKEN });
      }),
    ),
  );
}

/** Who writes a message on an item's thread: a member of its workspace by their account, under the key their client made, or the item's own agent. */
type InboxMessageWriter =
  | {
      readonly author: typeof INBOX_MESSAGE_AUTHOR.MEMBER;
      readonly userId: string;
      readonly clientKey: string;
    }
  | { readonly author: typeof INBOX_MESSAGE_AUTHOR.AGENT };

/** What a member's message under its key came to. */
export const INBOX_MESSAGE_OUTCOME = {
  /** This write wrote it. */
  WRITTEN: "written",
  /** The key found the same message written already, by the same member, with the same words and files. */
  REPEATED: "repeated",
  /** The key found another message written already, by another member or with other words or files; nothing was written. */
  KEY_REUSED: "key-reused",
} as const;

type InboxMessageOutcome = (typeof INBOX_MESSAGE_OUTCOME)[keyof typeof INBOX_MESSAGE_OUTCOME];

/** What a message came to: the item as it then stands, and what this write did. */
export interface InboxMessageWritten {
  readonly item: InboxItem;
  readonly outcome: InboxMessageOutcome;
}

const KeyedMessageSchema = Schema.Struct({
  userId: Schema.NullOr(Schema.String),
  text: Schema.String,
  files: Schema.Array(Schema.Struct({ name: Schema.String, mediaType: Schema.String })),
});

/** The message standing under a member's key on the item: who wrote it, its words, and its files by name and type in order. */
const findKeyedMessage = SqlSchema.findOneOption({
  Request: Schema.Struct({ itemId: Schema.String, clientKey: Schema.String }),
  Result: KeyedMessageSchema,
  execute: ({ itemId, clientKey }) =>
    Database.use((db) =>
      db
        .select({
          userId: inboxMessage.userId,
          text: inboxMessage.text,
          files: sql<unknown>`(select coalesce(jsonb_agg(jsonb_build_object('name', ${attachment.name}, 'mediaType', ${attachment.contentType}) order by ${attachment.position}), '[]'::jsonb) from ${attachment} where ${attachment.inboxMessageId} = ${MESSAGE.id})`,
        })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.itemId, itemId), eq(inboxMessage.clientKey, clientKey))),
    ),
});

/** Whether the message standing under the key is the one sent again: the same member, the same words, and the same files by name and type. */
function sameMessage(
  standing: typeof KeyedMessageSchema.Type,
  sent: {
    readonly userId: string;
    readonly text: string;
    readonly files: readonly MessageFile[];
  },
): boolean {
  return (
    standing.userId === sent.userId &&
    standing.text === sent.text &&
    standing.files.length === sent.files.length &&
    standing.files.every(
      (file, at) =>
        file.name === sent.files[at]?.name && file.mediaType === sent.files[at]?.contentType,
    )
  );
}

/**
 * The message written on the item's thread, the item standing open or
 * settled, with the files it carried in the order given, and the item's
 * last change moved to now, all in one write: the item's status, answer,
 * and revision are left as they stand. A member's message sent again under
 * its key is the one already written, which writes nothing and moves
 * nothing; another message under a key already taken, by another member or
 * with other words or files, is refused as the key reused, so the thread
 * never names one message while the agent hears another. A member's
 * message marks the item read for them in the same write. The item comes
 * back as the reader named reads it: the member, or the agent's starter.
 * The caller has read the item as the writer may reach it, so the
 * item named is one that stands.
 */
function writeInboxMessage(
  readerId: string,
  itemId: string,
  writer: InboxMessageWriter,
  text: string,
  files: readonly MessageFile[],
): InboxStoreEffect<Option.Option<InboxMessageWritten>> {
  const member = writer.author === INBOX_MESSAGE_AUTHOR.MEMBER ? writer : undefined;
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const written = yield* insertMessage({
          itemId,
          author: writer.author,
          userId: member?.userId ?? null,
          text,
          ask: null,
          answers: null,
          clientKey: member?.clientKey ?? null,
          now,
        });
        if (Option.isSome(written)) {
          const scope = yield* itemScope({ itemId });
          yield* Effect.forEach(files, (file, position) =>
            insertMessageFile({
              ...scope,
              itemId,
              messageId: written.value.id,
              ...file,
              position,
              now,
            }),
          );
          yield* touchItem({ itemId, now });
          // A member's own message leaves the item read for them, and unread for every other member.
          if (member !== undefined) yield* upsertRead({ userId: member.userId, itemId });
        }
        const outcome = Option.isSome(written)
          ? INBOX_MESSAGE_OUTCOME.WRITTEN
          : yield* repeatOutcome(itemId, member, text, files);
        const found = yield* findItemOf({ readerId, itemId });
        return Option.map(found, (row) => ({ item: storedItem(row).item, outcome }));
      }),
    ),
  );
}

/** What a member's message whose key found one standing came to: the same message sent again, or another under a key reused. */
function repeatOutcome(
  itemId: string,
  member: { readonly userId: string; readonly clientKey: string } | undefined,
  text: string,
  files: readonly MessageFile[],
): InboxStoreEffect<InboxMessageOutcome> {
  if (member === undefined) return Effect.succeed(INBOX_MESSAGE_OUTCOME.KEY_REUSED);
  return Effect.map(findKeyedMessage({ itemId, clientKey: member.clientKey }), (standing) =>
    Option.isSome(standing) && sameMessage(standing.value, { userId: member.userId, text, files })
      ? INBOX_MESSAGE_OUTCOME.REPEATED
      : INBOX_MESSAGE_OUTCOME.KEY_REUSED,
  );
}

/**
 * A member's message on an item of a workspace they are a member of, open
 * or settled, as `writeInboxMessage` writes one; nothing where the account
 * reaches no such item.
 */
export function postInboxMessage(
  userId: string,
  itemId: string,
  message: {
    readonly text: string;
    readonly clientKey: string;
    readonly files?: readonly CodingAgentAttachment[] | undefined;
  },
): InboxStoreEffect<Option.Option<InboxMessageWritten>> {
  return Effect.flatMap(findItem({ userId, itemId }), (found) =>
    Option.isNone(found)
      ? Effect.succeed(Option.none())
      : writeInboxMessage(
          userId,
          itemId,
          { author: INBOX_MESSAGE_AUTHOR.MEMBER, userId, clientKey: message.clientKey },
          message.text,
          (message.files ?? []).map((file) => ({
            name: file.name,
            contentType: file.mediaType,
            bytes: bytesOf(file),
          })),
        ),
  );
}

/** The agent's own item under the key, as its tools name one, where the member who started the agent is still a member of the item's workspace. */
const findAgentItem = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...AgentKeySchema.fields, key: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId, key }) =>
    Database.use((db) =>
      db
        .select({ id: inboxItem.id })
        .from(inboxItem)
        .where(
          and(
            eq(inboxItem.userId, userId),
            eq(inboxItem.agentId, agentId),
            eq(inboxItem.key, key),
            itemReachableBy(userId),
          ),
        ),
    ),
});

/**
 * The agent's message on the thread of its own item under the key, open or
 * settled, as `writeInboxMessage` writes one, with the pictures it read from
 * its sandbox, each named by its file's own name; nothing where it has no
 * item under the key, or its starter has left the item's workspace, which
 * writes there as one outside it no longer.
 */
export function replyInboxItem(
  agent: Pick<InboxAgent, "userId" | "agentId">,
  key: string,
  text: string,
  pictures: readonly InboxNamedImage[] = [],
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(findAgentItem({ ...agent, key }), (found) =>
    Option.isNone(found)
      ? Effect.succeed(Option.none())
      : Effect.map(
          writeInboxMessage(
            agent.userId,
            found.value.id,
            { author: INBOX_MESSAGE_AUTHOR.AGENT },
            text,
            pictures,
          ),
          Option.map((written) => written.item),
        ),
  );
}

/**
 * The member's message written under the key taken back off the item's
 * thread, its files with it, where the account still reaches the item: what
 * a hand-off to the agent that failed leaves, so the thread never shows a
 * message the agent was not told. The item's last change stays where the
 * message moved it.
 */
export function withdrawInboxMessage(
  userId: string,
  itemId: string,
  clientKey: string,
): InboxStoreEffect<void> {
  return Effect.flatMap(findItem({ userId, itemId }), (found) =>
    Option.isNone(found) ? Effect.void : deleteMessage({ itemId, clientKey }),
  );
}

/** One item that waits as the account's read holds it: the entry the wire carries, and where it stands, which a cursor digests. */
type AccountWaitingRow = AccountInboxEntry & Pick<InboxStamp, "status">;

/**
 * Every item that waits on the developer across the account's tasks, the
 * latest changed first: open, and on a task the account has not archived.
 * Note that none is left out for being old, because one left unanswered
 * while many others changed must still be counted; the open bound per
 * agent keeps these few.
 */
export function accountWaitingItems(
  userId: string,
): InboxStoreEffect<readonly AccountWaitingRow[]> {
  return Effect.map(findWaitingItems({ userId }), (rows) =>
    rows.map(({ taskId, ...row }) => ({
      ...row,
      planId: taskId,
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** One open item of an agent with no task as the account's read carries it, and where it stands. */
type AccountTasklessRow = AccountTasklessEntry & Pick<InboxStamp, "status">;

/**
 * Every item that waits on the developer from an agent with no task in the
 * account's workspaces, the latest changed first, with the automation and
 * repository that stand in a task's place; none is left out for being old,
 * as `accountWaitingItems` leaves none out.
 */
export function accountTasklessItems(
  userId: string,
): InboxStoreEffect<readonly AccountTasklessRow[]> {
  return Effect.map(findTasklessWaitingItems({ userId }), (rows) =>
    rows.map(({ workspaceId, ...row }) => ({
      ...row,
      ...(workspaceId === null ? undefined : { workspaceId }),
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** Where each item `accountWaitingItems` and `accountPlanlessItems` read stands, the same items and none of their words: what a held read of the account compares between looks. */
export function accountWaitingStamps(userId: string): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(findWaitingStamps({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

/**
 * Every task the account has not archived that holds an inbox item,
 * waiting or settled, with how many and when the latest changed, the
 * task whose item changed latest first: what the desktop's Inbox lists;
 * the archived ones among them where `archived` asks, which its Archived
 * tab lists.
 */
export function accountInboxTasks(
  userId: string,
  { archived = false }: { readonly archived?: boolean } = {},
): InboxStoreEffect<readonly AccountInboxTask[]> {
  return Effect.map(findTasksWithItems({ userId, archived }), (rows) =>
    rows.map(({ taskId, ...row }) => ({
      ...row,
      planId: taskId,
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** Every automation whose runs' agents with no task hold an item, waiting or settled, listed as `accountInboxTasks` lists the tasks. */
export function accountInboxAutomations(
  userId: string,
): InboxStoreEffect<readonly AccountInboxAutomation[]> {
  return Effect.map(findAutomationsWithItems({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}
