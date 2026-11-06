import { randomUUID } from "node:crypto";
import {
  LIVE_COUNT,
  type LiveStatement,
  liveKeysIn,
  liveLatest,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import {
  Database,
  type DatabaseServices,
  type QueryError,
  queryBuilder,
} from "@repo/database/core/query";
import { automationReadableBy } from "@repo/database/models/automation-store";
import { InstantColumnSchema } from "@repo/database/models/columns";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  agentSeenBy,
  agentVisibleTo,
  isWorkspaceMember,
  taskReachableBy,
  workspaceReachableBy,
} from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { attachment } from "@repo/database/schemas/attachment";
import { organization, user } from "@repo/database/schemas/auth";
import { automation } from "@repo/database/schemas/automation";
import { inboxItem } from "@repo/database/schemas/inbox";
import { inboxItemRead } from "@repo/database/schemas/inbox-item-read";
import { inboxMessage } from "@repo/database/schemas/inbox-message";
import { task } from "@repo/database/schemas/task";
import { INBOX_ATTACHMENT_KIND } from "@repo/database/storage-vocabulary";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  attachmentSync,
  inboxItemReadSync,
  inboxItemSync,
  inboxMessageSync,
  taskSync,
  userSync,
} from "@repo/database/sync/tables";
import type {
  AccountInboxAgent,
  AccountInboxAutomation,
  AccountInboxEntry,
  AccountInboxTask,
  AccountTasklessEntry,
} from "@repo/features/account-inbox-wire";
import type { AgentAttachment } from "@repo/features/agent-wire";
import type { ConversationMediaType } from "@repo/features/conversation-picture-wire";
import {
  INBOX_PICTURE_IN_WORDS,
  type InboxItemPlace,
  inboxAttachmentAddress,
  inboxPictureDestination,
} from "@repo/features/inbox-attachment-link";
import {
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_FILE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxAnswers,
  type InboxAsk,
  type InboxAskStanding,
  type InboxFileType,
  type InboxItem,
  type InboxItemHome,
  type InboxMessage,
  inboxAnswersRefusal,
  inboxAnswersSchema,
  inboxReadAskSchema,
  knownAsk,
  standingAsk,
} from "@repo/features/inbox-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import { insideCode } from "@repo/features/mention-link";
import {
  and,
  count,
  desc,
  eq,
  exists,
  getTableName,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  max,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { type AnyPgColumn, type AnyPgTable, alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import type { SyncMoved } from "../sync/live-query.js";

type InboxStoreFailure = QueryError | Schema.SchemaError;

export type InboxStoreEffect<A> = Effect.Effect<A, InboxStoreFailure, DatabaseServices>;

export interface InboxAgent {
  readonly userId: string;
  readonly taskId: string | null;
  readonly agentId: string;
}

export const INBOX_POST_REFUSAL = {
  TOO_MANY_OPEN: "too-many-open",
  TOO_MANY_NOTICES: "too-many-notices",
  NO_AGENT: "no-agent",
  NO_TITLE: "no-title",
  NO_ADDRESSEE: "no-addressee",
  ADDRESSEE_CANNOT_SEE: "addressee-cannot-see",
} as const;

export type InboxPostRefusal = (typeof INBOX_POST_REFUSAL)[keyof typeof INBOX_POST_REFUSAL];

export interface InboxStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: InboxItem["status"];
  readonly updatedAt: number;
  readonly unread: boolean;
  readonly waitsOn: string;
}

export interface StoredInboxItem {
  readonly item: InboxItem;
  readonly answerKey: string | null;
}

export interface InboxImage {
  readonly contentType: ConversationMediaType;
  readonly bytes: Uint8Array;
}

export interface InboxNamedImage extends InboxImage {
  readonly name: string;
}

interface MessageFile {
  readonly id?: string;
  readonly name: string;
  readonly contentType: InboxFileType;
  readonly bytes: Uint8Array;
}

export interface InboxFile {
  readonly contentType: InboxFileType;
  readonly bytes: Uint8Array;
}

export type InboxItemWritten = InboxItem & { readonly txid?: string };

export interface InboxMarked {
  readonly txid?: string;
}

const TXID = sql<string>`pg_current_xact_id()::text`;

const inboxFileTypeSchema = Schema.Literals(Object.values(INBOX_FILE_TYPE));

const ITEM_ID = sql`${sql.identifier(getTableName(inboxItem))}.${sql.identifier(inboxItem.id.name)}`;

function qualified(table: AnyPgTable, column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;
}

const ITEM_OPEN_ASK = qualified(inboxItem, inboxItem.openAskMessageId);

const MESSAGE = {
  id: qualified(inboxMessage, inboxMessage.id),
  author: qualified(inboxMessage, inboxMessage.author),
  userId: qualified(inboxMessage, inboxMessage.userId),
  text: qualified(inboxMessage, inboxMessage.text),
  ask: qualified(inboxMessage, inboxMessage.ask),
  answers: qualified(inboxMessage, inboxMessage.answers),
  addresseeId: qualified(inboxMessage, inboxMessage.addresseeId),
  clientKey: qualified(inboxMessage, inboxMessage.clientKey),
  createdAt: qualified(inboxMessage, inboxMessage.createdAt),
};

const MESSAGE_FILES = sql`(select coalesce(jsonb_agg(jsonb_build_object('attachmentId', ${attachment.id}, 'name', ${attachment.name}, 'mediaType', ${attachment.contentType}) order by ${attachment.position}), '[]'::jsonb) from ${attachment} where ${attachment.inboxMessageId} = ${MESSAGE.id})`;

const MESSAGES_READ = sql.raw(String(INBOX_BOUNDS.MAX_MESSAGES_READ));

function messagesAs(select: SQL): SQL {
  return sql`(${select}) as ${sql.identifier(getTableName(inboxMessage))}`;
}

const THREAD_MESSAGES = messagesAs(
  sql`select * from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} and (${inboxMessage.id} in (select ${inboxMessage.id} from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} order by ${inboxMessage.createdAt} desc, ${inboxMessage.id} desc limit ${MESSAGES_READ}) or ${inboxMessage.id} = (select ${inboxMessage.id} from ${inboxMessage} where ${inboxMessage.itemId} = ${ITEM_ID} order by ${inboxMessage.createdAt}, ${inboxMessage.id} limit 1) or ${inboxMessage.id} = ${ITEM_OPEN_ASK})`,
);

function messagesOf(source: SQL): SQL<unknown> {
  return sql<unknown>`(select coalesce(jsonb_agg(jsonb_build_object('id', ${MESSAGE.id}, 'author', ${MESSAGE.author}, 'userId', ${MESSAGE.userId}, 'name', (select "name" from ${user} where ${user.id} = ${MESSAGE.userId}), 'text', ${MESSAGE.text}, 'files', ${MESSAGE_FILES}, 'ask', ${MESSAGE.ask}, 'answers', ${MESSAGE.answers}, 'addresseeId', ${MESSAGE.addresseeId}, 'addresseeName', (select "name" from ${user} where ${user.id} = ${MESSAGE.addresseeId}), 'clientKey', ${MESSAGE.clientKey}, 'createdAt', floor(extract(epoch from ${MESSAGE.createdAt}) * 1000)::bigint) order by ${MESSAGE.createdAt}, ${MESSAGE.id}), '[]'::jsonb) from ${source})`;
}

const SETTLED = sql`${inboxItem.status} <> ${INBOX_STATUS.OPEN}`;

const NOTICE = sql`${inboxItem.openAskMessageId} is null`;

const ASKING = sql<boolean>`(${inboxItem.status} = ${INBOX_STATUS.OPEN} and not (${NOTICE}))`;

const ITEM_TABLE = sql.identifier(getTableName(inboxItem));
const ITEM_UPDATED_AT = sql`${ITEM_TABLE}.${sql.identifier(inboxItem.updatedAt.name)}`;
const ITEM_READ_THROUGH = sql`${ITEM_TABLE}.${sql.identifier(inboxItem.readThrough.name)}`;

const READ = {
  itemId: qualified(inboxItemRead, inboxItemRead.itemId),
  userId: qualified(inboxItemRead, inboxItemRead.userId),
  readThrough: qualified(inboxItemRead, inboxItemRead.readThrough),
  markedUnread: qualified(inboxItemRead, inboxItemRead.markedUnread),
  remindAt: qualified(inboxItemRead, inboxItemRead.remindAt),
  remindThrough: qualified(inboxItemRead, inboxItemRead.remindThrough),
};

function unreadFor(readerId: string): SQL<boolean> {
  const noMarker = sql`${ITEM_UPDATED_AT} > coalesce(${ITEM_READ_THROUGH}, '-infinity'::timestamptz)`;
  return sql<boolean>`coalesce((select ${READ.markedUnread} or ${ITEM_UPDATED_AT} > coalesce(greatest(${READ.readThrough}, ${ITEM_READ_THROUGH}), '-infinity'::timestamptz) from ${inboxItemRead} where ${READ.itemId} = ${ITEM_ID} and ${READ.userId} = ${readerId}), ${noMarker})`;
}

function markedUnreadFor(readerId: string): SQL<boolean> {
  return sql<boolean>`coalesce((select ${READ.markedUnread} from ${inboxItemRead} where ${READ.itemId} = ${ITEM_ID} and ${READ.userId} = ${readerId}), false)`;
}

function remindAtFor(readerId: string): SQL<Date | null> {
  return sql<Date | null>`(select ${READ.remindAt} from ${inboxItemRead} where ${READ.itemId} = ${ITEM_ID} and ${READ.userId} = ${readerId} and coalesce(${READ.remindThrough} >= ${ITEM_UPDATED_AT}, not ${READ.markedUnread} and ${READ.readThrough} >= ${ITEM_UPDATED_AT}))`;
}

function remindAtMillisFor(readerId: string): SQL<number | null> {
  return sql<number | null>`floor(extract(epoch from ${remindAtFor(readerId)}) * 1000)::float8`;
}

function liveReminderFor(readerId: string): { remindAt: SQL; snoozedUntil: SQL } {
  return { remindAt: remindAtFor(readerId), snoozedUntil: remindAtFor(readerId) };
}

const WAITS_ON = sql<string>`coalesce(${qualified(inboxItem, inboxItem.addresseeId)}, (select ${qualified(task, task.assigneeId)} from ${task} where ${qualified(task, task.id)} = ${qualified(inboxItem, inboxItem.taskId)}), ${qualified(inboxItem, inboxItem.userId)})`;

const ADDRESSED = sql<boolean>`(${qualified(inboxItem, inboxItem.addresseeId)} is not null)`;

const WAITS_ON_NAME = sql<
  string | null
>`(select "name" from ${user} where ${user.id} = ${WAITS_ON})`;

const SETTLED_AT = sql<
  number | null
>`floor(extract(epoch from coalesce(${inboxItem.settledAt}, case when ${SETTLED} then ${inboxItem.updatedAt} end)) * 1000)::float8`;

function inboxColumns(readerId: string) {
  return {
    ...INBOX_ITEM_COLUMNS,
    unread: unreadFor(readerId),
    markedUnread: markedUnreadFor(readerId),
    remindAt: remindAtMillisFor(readerId),
  };
}

const INBOX_ITEM_COLUMNS = {
  id: inboxItem.id,
  agentId: inboxItem.agentId,
  key: inboxItem.key,
  revision: inboxItem.revision,
  version: inboxItem.version,
  title: inboxItem.title,
  needsReply: inboxItem.needsReply,
  status: inboxItem.status,
  startedBy: inboxItem.userId,
  startedByName: sql<
    string | null
  >`(select "name" from ${user} where ${user.id} = ${inboxItem.userId})`,
  waitsOn: WAITS_ON,
  waitsOnName: WAITS_ON_NAME,
  addressed: ADDRESSED,
  answerKey: inboxItem.answerKey,
  answeredBy: inboxItem.answeredBy,
  answeredByName: sql<
    string | null
  >`(select "name" from ${user} where ${user.id} = ${inboxItem.answeredBy})`,
  closedReason: inboxItem.closedReason,
  closedBy: inboxItem.closedBy,
  closedByName: sql<
    string | null
  >`(select "name" from ${user} where ${user.id} = ${inboxItem.closedBy})`,
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
  addresseeId: Schema.NullOr(Schema.String),
  addresseeName: Schema.NullOr(Schema.String),
  clientKey: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});

type MessageRow = typeof MessageRowSchema.Type;

function storedMessage(
  row: MessageRow,
  item: InboxAskStanding,
  keysFor: string | undefined,
): InboxMessage {
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
    ...(row.addresseeId === null || row.addresseeName === null
      ? undefined
      : { addressedTo: { userId: row.addresseeId, name: row.addresseeName } }),
    ...(keysFor === undefined || row.userId !== keysFor || row.clientKey === null
      ? undefined
      : { clientKey: row.clientKey }),
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
  needsReply: Schema.Boolean,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  startedBy: Schema.String,
  startedByName: Schema.NullOr(Schema.String),
  waitsOn: Schema.String,
  waitsOnName: Schema.NullOr(Schema.String),
  addressed: Schema.Boolean,
  answerKey: Schema.NullOr(Schema.String),
  answeredBy: Schema.NullOr(Schema.String),
  answeredByName: Schema.NullOr(Schema.String),
  closedReason: Schema.NullOr(Schema.String),
  closedBy: Schema.NullOr(Schema.String),
  closedByName: Schema.NullOr(Schema.String),
  thread: Schema.Array(MessageRowSchema),
  openAskMessageId: Schema.NullOr(Schema.String),
  postedAt: InstantColumnSchema,
  settledAt: Schema.NullOr(Schema.Number),
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
  markedUnread: Schema.Boolean,
  remindAt: Schema.NullOr(Schema.Number),
});

type InboxRow = typeof InboxRowSchema.Type;

function storedItem(row: InboxRow, keysFor?: string): StoredInboxItem {
  const message = (each: MessageRow) => storedMessage(each, row, keysFor);
  return {
    item: {
      id: row.id,
      agentId: row.agentId,
      key: row.key,
      revision: row.revision,
      version: row.version,
      title: row.title,
      needsReply: row.needsReply,
      status: row.status,
      ...(row.startedByName === null
        ? undefined
        : { startedBy: { userId: row.startedBy, name: row.startedByName } }),
      ...(row.waitsOnName === null
        ? undefined
        : { waitsOn: { userId: row.waitsOn, name: row.waitsOnName } }),
      addressed: row.addressed,
      ...(row.answeredBy === null || row.answeredByName === null
        ? undefined
        : { answeredBy: { userId: row.answeredBy, name: row.answeredByName } }),
      ...(row.closedReason === null ? undefined : { closedReason: row.closedReason }),
      ...(row.closedBy === null || row.closedByName === null
        ? undefined
        : { closedBy: { userId: row.closedBy, name: row.closedByName } }),
      ...(row.thread.length === 0 ? undefined : { thread: row.thread.map(message) }),
      postedAt: row.postedAt.getTime(),
      ...(row.settledAt === null ? undefined : { settledAt: row.settledAt }),
      updatedAt: row.updatedAt.getTime(),
      unread: row.unread,
      ...(row.markedUnread ? { markedUnread: true } : undefined),
      ...(row.remindAt === null
        ? undefined
        : { remindAt: row.remindAt, snoozedUntil: row.remindAt }),
    },
    answerKey: row.answerKey,
  };
}

const AgentKeySchema = Schema.Struct({ userId: Schema.String, agentId: Schema.String });

const ITEM_WORKSPACE = sql<string>`${inboxItem.organizationId}`;

function itemAgentSeenBy(userId: string): SQL {
  const seen = exists(
    queryBuilder
      .select({ one: agentTable.id })
      .from(agentTable)
      .where(and(eq(agentTable.id, inboxItem.agentId), agentSeenBy(userId))),
  );
  return sql`(${isNull(inboxItem.agentId)} or ${seen})`;
}

function itemReachableBy(userId: string): SQL {
  return sql`(${workspaceReachableBy(userId, ITEM_WORKSPACE)} and ${itemAgentSeenBy(userId)})`;
}

function itemVisibleTo(userId: string): SQL {
  const taskReached = exists(
    queryBuilder
      .select({ one: task.id })
      .from(task)
      .where(and(eq(task.id, inboxItem.taskId), taskReachableBy(userId))),
  );
  return sql`(${itemReachableBy(userId)} and (${inboxItem.taskId} is null or ${taskReached}))`;
}

const AGENT_WORKSPACE_STEP = sql<string>`coalesce((select ${organization.slug} from ${organization} where ${organization.id} = ${AGENT_WORKSPACE}), ${AGENT_WORKSPACE})`;

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
          id: agentTable.id,
          organizationId: AGENT_WORKSPACE,
          workspaceStep: AGENT_WORKSPACE_STEP,
        })
        .from(agentTable)
        .where(
          and(eq(agentTable.id, agentId), eq(agentTable.userId, userId), agentReachableBy(userId)),
        )
        .for("update"),
    ),
});

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
            ASKING,
            ne(inboxItem.key, key),
          ),
        ),
    ),
});

const countNoticesBesides = SqlSchema.findOne({
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
            NOTICE,
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
  needsReply: Schema.Boolean,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  settledAt: Schema.NullOr(Schema.Date),
  addresseeId: Schema.NullOr(Schema.String),
  now: Schema.Date,
});

const MessageWriteSchema = Schema.Struct({
  itemId: Schema.String,
  author: Schema.Literals(Object.values(INBOX_MESSAGE_AUTHOR)),
  userId: Schema.NullOr(Schema.String),
  text: Schema.String,
  ask: Schema.NullOr(Schema.toType(inboxReadAskSchema)),
  answers: Schema.NullOr(inboxAnswersSchema),
  addresseeId: Schema.NullOr(Schema.String),
  clientKey: Schema.NullOr(Schema.String),
  now: Schema.Date,
});

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
  userId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
  itemId: Schema.String,
  name: Schema.String,
  position: Schema.Number,
  contentType: inboxFileTypeSchema,
  bytes: Schema.Uint8Array,
  now: Schema.Date,
  messageId: Schema.String,
  id: Schema.optionalKey(Schema.String),
});

const insertMessageFiles = SqlSchema.void({
  Request: Schema.Array(MessageFileWriteSchema),
  execute: (files) =>
    Database.use((db) =>
      db.insert(attachment).values(
        files.map(({ now, itemId, messageId, ...file }) => ({
          ...file,
          inboxItemId: itemId,
          inboxMessageId: messageId,
          kind: INBOX_ATTACHMENT_KIND.MESSAGE,
          byteCount: file.bytes.byteLength,
          createdAt: now,
        })),
      ),
    ),
});

function writeMessageFiles(
  files: readonly (typeof MessageFileWriteSchema.Type)[],
): InboxStoreEffect<void> {
  return files.length === 0 ? Effect.void : insertMessageFiles(files);
}

const AskStandingSchema = Schema.Struct({
  status: Schema.Literals(Object.values(INBOX_ASK_STATUS)),
  withdrawnReason: Schema.NullOr(Schema.String),
  withdrawnAt: Schema.NullOr(Schema.Number),
});

function askStanding({ status, withdrawnReason, withdrawnAt }: typeof AskStandingSchema.Type): SQL {
  const standing = sql`jsonb_strip_nulls(jsonb_build_object('status', ${status}::text, 'withdrawnReason', ${withdrawnReason}::text, 'withdrawnAt', ${withdrawnAt}::bigint))`;
  return sql`(${inboxMessage.ask} - 'withdrawnAt') || ${standing}`;
}

const ASK_KEPT_OPEN = sql`${inboxMessage.ask} ->> 'status' = ${INBOX_ASK_STATUS.OPEN}`;

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

const holdAsk = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, messageId: Schema.String }),
  execute: ({ itemId, messageId }) =>
    Database.use((db) =>
      db.update(inboxItem).set({ openAskMessageId: messageId }).where(eq(inboxItem.id, itemId)),
    ),
});

const findOpenAsk = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, itemId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, ask: inboxReadAskSchema }),
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select({ id: inboxMessage.id, ask: inboxMessage.ask })
        .from(inboxMessage)
        .innerJoin(inboxItem, eq(inboxItem.openAskMessageId, inboxMessage.id))
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemVisibleTo(userId),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
            ASK_KEPT_OPEN,
          ),
        ),
    ),
});

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

const deleteMessage = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, clientKey: Schema.String }),
  execute: ({ itemId, clientKey }) =>
    Database.use((db) =>
      db
        .delete(inboxMessage)
        .where(and(eq(inboxMessage.itemId, itemId), eq(inboxMessage.clientKey, clientKey))),
    ),
});

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
            itemVisibleTo(userId),
          ),
        ),
    ),
});

const upsertItem = SqlSchema.findOne({
  Request: PostWriteSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (write) => {
    const posted = {
      version: INBOX_WIRE_VERSION,
      title: write.title,
      needsReply: write.needsReply,
      status: write.status,
      answerKey: null,
      answeredBy: null,
      closedReason: null,
      closedBy: null,
      settledAt: write.settledAt,
      updatedAt: write.now,
      openAskMessageId: null,
      addresseeId: write.addresseeId,
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
          openAskMessageId: null,
        })
        .where(
          and(
            eq(inboxItem.userId, userId),
            eq(inboxItem.agentId, agentId),
            eq(inboxItem.key, key),
            ASKING,
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

const INBOX_SCOPE = {
  TASK: "plan",
  AGENT: "agent",
  AGENT_OF_WORKSPACE: "agent-of-workspace",
  WORKSPACE: "workspace",
} as const;

const ScopeSchema = Schema.Struct({
  userId: Schema.String,
  scope: Schema.Literals(Object.values(INBOX_SCOPE)),
  id: Schema.String,
});

type InboxScope = typeof ScopeSchema.Type;

function inScope(scope: InboxScope) {
  switch (scope.scope) {
    case INBOX_SCOPE.TASK:
      return and(eq(inboxItem.taskId, scope.id), itemVisibleTo(scope.userId));
    case INBOX_SCOPE.AGENT_OF_WORKSPACE:
      return and(eq(inboxItem.agentId, scope.id), itemVisibleTo(scope.userId));
    case INBOX_SCOPE.WORKSPACE:
      return and(eq(inboxItem.organizationId, scope.id), itemVisibleTo(scope.userId));
    case INBOX_SCOPE.AGENT:
      return and(eq(inboxItem.agentId, scope.id), eq(inboxItem.userId, scope.userId));
  }
}

const LATEST_FIRST = [desc(inboxItem.updatedAt), desc(inboxItem.id)] as const;

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

const StampRowSchema = Schema.Struct({
  id: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
  waitsOn: Schema.String,
});

function stampColumns(readerId: string) {
  return {
    id: inboxItem.id,
    revision: inboxItem.revision,
    status: inboxItem.status,
    updatedAt: inboxItem.updatedAt,
    unread: unreadFor(readerId),
    waitsOn: WAITS_ON,
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

function accountWaiting(userId: string) {
  return and(
    isNotNull(inboxItem.taskId),
    itemVisibleTo(userId),
    eq(inboxItem.status, INBOX_STATUS.OPEN),
  );
}

function tasklessWaiting(userId: string) {
  return and(
    isNull(inboxItem.taskId),
    itemVisibleTo(userId),
    eq(inboxItem.status, INBOX_STATUS.OPEN),
  );
}

function repositoryCarried(repositoryless: boolean): SQL | undefined {
  return repositoryless ? undefined : isNotNull(agentTable.repository);
}

function toDoCount(userId: string): SQL<number> {
  return sql<number>`(count(*) filter (where ${askingReader(userId)}))::int`;
}

function accountUnreadSettled(userId: string) {
  const derived = or(
    and(eq(inboxItem.userId, userId), isNull(task.assigneeId)),
    eq(task.assigneeId, userId),
  );
  return and(
    itemVisibleTo(userId),
    or(eq(inboxItem.addresseeId, userId), and(isNull(inboxItem.addresseeId), derived)),
    ne(inboxItem.status, INBOX_STATUS.OPEN),
    unreadFor(userId),
  );
}

const AccountRequestSchema = Schema.Struct({ userId: Schema.String });

const WaitingRowSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  startedBy: Schema.String,
  waitsOn: Schema.String,
  title: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
  asking: Schema.Boolean,
  remindAt: Schema.NullOr(Schema.Number),
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
          agentTitle: agentTable.title,
          agentModel: agentTable.model,
          startedBy: agentTable.userId,
          waitsOn: WAITS_ON,
          title: inboxItem.title,
          revision: inboxItem.revision,
          status: inboxItem.status,
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
          unread: unreadFor(userId),
          asking: ASKING,
          remindAt: remindAtMillisFor(userId),
        })
        .from(inboxItem)
        .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
        .where(accountWaiting(userId))
        .orderBy(...LATEST_FIRST),
    ),
});

const TasklessRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  startedBy: Schema.String,
  waitsOn: Schema.String,
  automationId: Schema.NullOr(Schema.String),
  automationName: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  workspaceId: Schema.NullOr(Schema.String),
  title: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
  unread: Schema.Boolean,
  asking: Schema.Boolean,
  remindAt: Schema.NullOr(Schema.Number),
});

const findTasklessWaitingItems = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, repositoryless: Schema.Boolean }),
  Result: TasklessRowSchema,
  execute: ({ userId, repositoryless }) =>
    Database.use((db) =>
      db
        .select({
          id: inboxItem.id,
          agentId: inboxItem.agentId,
          agentTitle: agentTable.title,
          agentModel: agentTable.model,
          startedBy: agentTable.userId,
          waitsOn: WAITS_ON,
          automationId: automation.id,
          automationName: automation.name,
          repository: agentTable.repository,
          workspaceId: agentTable.organizationId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          status: inboxItem.status,
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
          unread: unreadFor(userId),
          asking: ASKING,
          remindAt: remindAtMillisFor(userId),
        })
        .from(inboxItem)
        .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
        .leftJoin(
          automation,
          and(eq(automation.id, agentTable.automationId), automationReadableBy(userId)),
        )
        .where(and(tasklessWaiting(userId), repositoryCarried(repositoryless)))
        .orderBy(...LATEST_FIRST),
    ),
});

const findWaitingStamps = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: StampRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select(stampColumns(userId))
        .from(inboxItem)
        .leftJoin(task, eq(task.id, inboxItem.taskId))
        .where(or(accountWaiting(userId), tasklessWaiting(userId), accountUnreadSettled(userId)))
        .orderBy(...LATEST_FIRST),
    ),
});

const TaskItemsRowSchema = Schema.Struct({
  taskId: Schema.String,
  items: Schema.Number,
  toDo: Schema.Number,
  updatedAt: InstantColumnSchema,
});

const LATEST_ITEM = max(inboxItem.updatedAt);

const findTasksWithItems = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: TaskItemsRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          taskId: inboxItem.taskId,
          items: count(),
          toDo: toDoCount(userId),
          updatedAt: LATEST_ITEM,
        })
        .from(inboxItem)
        .where(and(isNotNull(inboxItem.taskId), itemVisibleTo(userId)))
        .groupBy(inboxItem.taskId)
        .orderBy(desc(LATEST_ITEM), desc(inboxItem.taskId)),
    ),
});

const AutomationItemsRowSchema = Schema.Struct({
  automationId: Schema.NullOr(Schema.String),
  items: Schema.Number,
  updatedAt: InstantColumnSchema,
});

const findAutomationsWithItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: AutomationItemsRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ automationId: automation.id, items: count(), updatedAt: LATEST_ITEM })
        .from(inboxItem)
        .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
        .leftJoin(
          automation,
          and(eq(automation.id, agentTable.automationId), automationReadableBy(userId)),
        )
        .where(and(isNull(inboxItem.taskId), itemVisibleTo(userId)))
        .groupBy(automation.id)
        .orderBy(desc(LATEST_ITEM), desc(automation.id)),
    ),
});

const AGENT_HOLDING_NAMING = {
  agentTitle: agentTable.title,
  agentModel: agentTable.model,
  automationId: automation.id,
  automationName: automation.name,
  repository: agentTable.repository,
  workspaceId: agentTable.organizationId,
};

const AgentItemsRowSchema = Schema.Struct({
  agentId: Schema.String,
  items: Schema.Number,
  toDo: Schema.Number,
  updatedAt: InstantColumnSchema,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  automationId: Schema.NullOr(Schema.String),
  automationName: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  workspaceId: Schema.NullOr(Schema.String),
});

const findAgentsWithItems = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, repositoryless: Schema.Boolean }),
  Result: AgentItemsRowSchema,
  execute: ({ userId, repositoryless }) =>
    Database.use((db) =>
      db
        .select({
          agentId: agentTable.id,
          items: count(),
          toDo: toDoCount(userId),
          updatedAt: LATEST_ITEM,
          ...AGENT_HOLDING_NAMING,
        })
        .from(inboxItem)
        .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
        .leftJoin(
          automation,
          and(eq(automation.id, agentTable.automationId), automationReadableBy(userId)),
        )
        .where(
          and(isNull(inboxItem.taskId), itemVisibleTo(userId), repositoryCarried(repositoryless)),
        )
        .groupBy(agentTable.id, automation.id)
        .orderBy(desc(LATEST_ITEM), desc(agentTable.id)),
    ),
});

export interface AccountInboxLiveStatements {
  readonly items: LiveStatement;
  readonly planless: LiveStatement;
  readonly plans: LiveStatement;
  readonly automations: LiveStatement;
  readonly agents: LiveStatement;
}

export function accountInboxLiveStatements(
  userId: string,
  repositoryless: boolean,
): Option.Option<AccountInboxLiveStatements> {
  const items = queryBuilder
    .select(
      liveSelection(
        {
          id: inboxItem.id,
          planId: inboxItem.taskId,
          agentId: inboxItem.agentId,
          agentTitle: agentTable.title,
          agentModel: agentTable.model,
          startedBy: agentTable.userId,
          waitsOn: WAITS_ON,
          title: inboxItem.title,
          revision: inboxItem.revision,
          unread: unreadFor(userId),
          asking: ASKING,
        },
        {
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
          ...liveReminderFor(userId),
        },
      ),
    )
    .from(inboxItem)
    .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
    .where(accountWaiting(userId));
  const planless = queryBuilder
    .select(
      liveSelection(
        {
          id: inboxItem.id,
          agentId: inboxItem.agentId,
          agentTitle: agentTable.title,
          agentModel: agentTable.model,
          startedBy: agentTable.userId,
          waitsOn: WAITS_ON,
          automationId: automation.id,
          automationName: automation.name,
          repository: agentTable.repository,
          workspaceId: agentTable.organizationId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          unread: unreadFor(userId),
          asking: ASKING,
        },
        {
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
          ...liveReminderFor(userId),
        },
      ),
    )
    .from(inboxItem)
    .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
    .leftJoin(
      automation,
      and(eq(automation.id, agentTable.automationId), automationReadableBy(userId)),
    )
    .where(and(tasklessWaiting(userId), repositoryCarried(repositoryless)));
  const plans = queryBuilder
    .select({
      ...liveSelection({ planId: inboxItem.taskId }),
      items: LIVE_COUNT.as("items"),
      toDo: toDoCount(userId).as("toDo"),
      updatedAt: liveLatest(inboxItem.updatedAt).as("updatedAt"),
    })
    .from(inboxItem)
    .where(and(isNotNull(inboxItem.taskId), itemVisibleTo(userId)))
    .groupBy(inboxItem.taskId);
  const automations = queryBuilder
    .select({
      ...liveSelection({ automationId: automation.id }),
      items: LIVE_COUNT.as("items"),
      updatedAt: liveLatest(inboxItem.updatedAt).as("updatedAt"),
    })
    .from(inboxItem)
    .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
    .leftJoin(
      automation,
      and(eq(automation.id, agentTable.automationId), automationReadableBy(userId)),
    )
    .where(and(isNull(inboxItem.taskId), itemVisibleTo(userId)))
    .groupBy(automation.id);
  const agents = queryBuilder
    .select({
      ...liveSelection({ agentId: agentTable.id, ...AGENT_HOLDING_NAMING }),
      items: LIVE_COUNT.as("items"),
      toDo: toDoCount(userId).as("toDo"),
      updatedAt: liveLatest(inboxItem.updatedAt).as("updatedAt"),
    })
    .from(inboxItem)
    .innerJoin(agentTable, eq(agentTable.id, inboxItem.agentId))
    .leftJoin(
      automation,
      and(eq(automation.id, agentTable.automationId), automationReadableBy(userId)),
    )
    .where(and(isNull(inboxItem.taskId), itemVisibleTo(userId), repositoryCarried(repositoryless)))
    .groupBy(agentTable.id, automation.id);
  return Option.all({
    items: liveStatementOf(items),
    planless: liveStatementOf(planless),
    plans: liveStatementOf(plans),
    automations: liveStatementOf(automations),
    agents: liveStatementOf(agents),
  });
}

export interface ScopeInboxLiveStatements {
  readonly items: LiveStatement;
  readonly messages: LiveStatement;
  readonly files: LiveStatement;
}

const sibling = alias(inboxMessage, "sibling");

function scopeLiveStatements(scope: InboxScope): Option.Option<ScopeInboxLiveStatements> {
  const latestSettled = queryBuilder
    .select({ id: inboxItem.id })
    .from(inboxItem)
    .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
    .orderBy(...LATEST_FIRST)
    .limit(INBOX_BOUNDS.MAX_ITEMS_READ);
  return itemsLiveStatements(
    scope.userId,
    and(
      inScope(scope),
      or(eq(inboxItem.status, INBOX_STATUS.OPEN), inArray(inboxItem.id, latestSettled)),
    ),
  );
}

function itemsLiveStatements(
  readerId: string,
  read: SQL | undefined,
): Option.Option<ScopeInboxLiveStatements> {
  const itemIds = queryBuilder.select({ id: inboxItem.id }).from(inboxItem).where(read);
  const ofItem = eq(sibling.itemId, qualified(inboxMessage, inboxMessage.itemId));
  const latest = queryBuilder
    .select({ id: sibling.id })
    .from(sibling)
    .where(ofItem)
    .orderBy(desc(sibling.createdAt), desc(sibling.id))
    .limit(INBOX_BOUNDS.MAX_MESSAGES_READ);
  const first = queryBuilder
    .select({ id: sibling.id })
    .from(sibling)
    .where(ofItem)
    .orderBy(sibling.createdAt, sibling.id)
    .limit(1);
  const latestMessage = and(
    inArray(inboxMessage.itemId, itemIds),
    or(
      inArray(MESSAGE.id, latest),
      inArray(MESSAGE.id, first),
      inArray(
        MESSAGE.id,
        queryBuilder.select({ id: inboxItem.openAskMessageId }).from(inboxItem).where(read),
      ),
    ),
  );
  const items = liveStatementOf(
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
            needsReply: inboxItem.needsReply,
            status: inboxItem.status,
            startedBy: inboxItem.userId,
            startedByName: INBOX_ITEM_COLUMNS.startedByName,
            waitsOn: WAITS_ON,
            waitsOnName: WAITS_ON_NAME,
            addressed: ADDRESSED,
            answeredBy: inboxItem.answeredBy,
            answeredByName: INBOX_ITEM_COLUMNS.answeredByName,
            closedReason: inboxItem.closedReason,
            closedBy: inboxItem.closedBy,
            closedByName: INBOX_ITEM_COLUMNS.closedByName,
            openAskMessageId: inboxItem.openAskMessageId,
            unread: unreadFor(readerId),
            markedUnread: markedUnreadFor(readerId),
          },
          {
            postedAt: inboxItem.postedAt,
            updatedAt: inboxItem.updatedAt,
            ...liveReminderFor(readerId),
            settledAt: sql`coalesce(${inboxItem.settledAt}, case when ${SETTLED} then ${inboxItem.updatedAt} end)`,
          },
        ),
      )
      .from(inboxItem)
      .where(read),
  );
  const messages = liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: MESSAGE.id,
            itemId: qualified(inboxMessage, inboxMessage.itemId),
            author: MESSAGE.author,
            userId: MESSAGE.userId,
            name: sql`(select "name" from ${user} where ${user.id} = ${MESSAGE.userId})`,
            text: MESSAGE.text,
            ask: MESSAGE.ask,
            answers: MESSAGE.answers,
            clientKey: sql`case when ${MESSAGE.userId} = ${readerId} then ${MESSAGE.clientKey} end`,
          },
          { createdAt: MESSAGE.createdAt },
        ),
      )
      .from(inboxMessage)
      .where(latestMessage),
  );
  const files = liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          attachmentId: attachment.id,
          messageId: attachment.inboxMessageId,
          name: attachment.name,
          mediaType: attachment.contentType,
          position: attachment.position,
        }),
      )
      .from(attachment)
      .where(
        inArray(
          attachment.inboxMessageId,
          queryBuilder.select({ id: MESSAGE.id }).from(inboxMessage).where(latestMessage),
        ),
      ),
  );
  return Option.all({ items, messages, files });
}

export interface AccountItemsLiveStatements extends ScopeInboxLiveStatements {
  readonly stamps: LiveStatement;
}

export function accountItemsLiveStatements(
  userId: string,
  since: Date,
  settledSince: Date,
): Option.Option<AccountItemsLiveStatements> {
  return accountItemsOf(userId, settledSince, sql`true`, gte(inboxItem.updatedAt, since));
}

function accountItemsOf(
  userId: string,
  settledSince: Date,
  narrowed: SQL,
  changed: SQL,
): Option.Option<AccountItemsLiveStatements> {
  const carried = and(
    itemVisibleTo(userId),
    or(
      eq(inboxItem.status, INBOX_STATUS.OPEN),
      sql`greatest(${inboxItem.updatedAt}, ${inboxItem.settledAt}, ${remindAtFor(userId)}) >= ${settledSince}`,
    ),
    narrowed,
  );
  const stamps = liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: inboxItem.id,
            planId: inboxItem.taskId,
            agentId: inboxItem.agentId,
            revision: inboxItem.revision,
            version: inboxItem.version,
            status: inboxItem.status,
            unread: unreadFor(userId),
            waitsOn: WAITS_ON,
            channelId: inboxItem.organizationId,
            messages: sql<number>`(select count(*)::int from ${inboxMessage} where ${qualified(inboxMessage, inboxMessage.itemId)} = ${ITEM_ID})`,
          },
          { updatedAt: inboxItem.updatedAt, ...liveReminderFor(userId) },
        ),
      )
      .from(inboxItem)
      .where(carried),
  );
  return Option.map(
    Option.all({
      stamps,
      changed: itemsLiveStatements(userId, and(carried, changed)),
    }),
    ({ stamps, changed }) => ({ stamps, ...changed }),
  );
}

const ITEM_NAMERS = [inboxMessageSync, inboxItemReadSync, attachmentSync, taskSync, agentSync];

function movedItems(moved: SyncMoved): SQL {
  const members = moved.keys(userSync, user.id);
  const named = (kind: typeof TOPIC.TASK | typeof TOPIC.AGENT) =>
    ITEM_NAMERS.flatMap((table) => moved.topics(table, kind));
  const assigned = queryBuilder
    .select({ id: task.id })
    .from(task)
    .where(liveKeysIn(task.assigneeId, members));
  const authored = queryBuilder
    .select({ id: inboxMessage.itemId })
    .from(inboxMessage)
    .where(liveKeysIn(inboxMessage.userId, members));
  return (
    or(
      liveKeysIn(inboxItem.id, moved.keys(inboxItemSync, inboxItem.id)),
      liveKeysIn(inboxItem.taskId, named(TOPIC.TASK)),
      liveKeysIn(inboxItem.agentId, named(TOPIC.AGENT)),
      liveKeysIn(inboxItem.userId, members),
      liveKeysIn(inboxItem.answeredBy, members),
      liveKeysIn(inboxItem.closedBy, members),
      liveKeysIn(inboxItem.addresseeId, members),
      members.length === 0 ? undefined : inArray(inboxItem.taskId, assigned),
      members.length === 0 ? undefined : inArray(inboxItem.id, authored),
    ) ?? sql`false`
  );
}

export function accountItemsDeltaStatements(
  userId: string,
  settledSince: Date,
  moved: SyncMoved,
): Option.Option<AccountItemsLiveStatements> {
  return accountItemsOf(userId, settledSince, movedItems(moved), sql`true`);
}

export function taskInboxLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<ScopeInboxLiveStatements> {
  return scopeLiveStatements({ userId, scope: INBOX_SCOPE.TASK, id: taskId });
}

export function memberAgentInboxLiveStatements(
  userId: string,
  agentId: string,
): Option.Option<ScopeInboxLiveStatements> {
  return scopeLiveStatements({ userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId });
}

function scopeItems(
  scope: InboxScope,
  settledLimit: number,
  keysFor?: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return Effect.map(
    Effect.all([findOpenItems(scope), findSettledItems({ ...scope, limit: settledLimit })], {
      concurrency: 2,
    }),
    ([open, settled]) => [...open, ...settled].map((row) => storedItem(row, keysFor).item),
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
        .where(and(eq(inboxItem.id, itemId), itemVisibleTo(userId))),
    ),
});

const findItemHome = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, itemId: Schema.String }),
  Result: Schema.Struct({
    agentId: Schema.String,
    planId: Schema.NullOr(Schema.String),
    workspaceId: Schema.String,
  }),
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select({
          agentId: inboxItem.agentId,
          planId: inboxItem.taskId,
          workspaceId: inboxItem.organizationId,
        })
        .from(inboxItem)
        .where(and(eq(inboxItem.id, itemId), itemVisibleTo(userId))),
    ),
});

const findItemOf = SqlSchema.findOneOption({
  Request: Schema.Struct({ readerId: Schema.String, itemId: Schema.String }),
  Result: InboxRowSchema,
  execute: ({ readerId, itemId }) =>
    Database.use((db) =>
      db.select(inboxColumns(readerId)).from(inboxItem).where(eq(inboxItem.id, itemId)),
    ),
});

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

function itemScope(request: { readonly itemId: string }) {
  return findItemScope(request).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
}

function excluded(column: AnyPgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

const READ_ON = {
  readThrough: sql`greatest(${inboxItemRead.readThrough}, ${excluded(inboxItemRead.readThrough)})`,
  markedUnread: false,
};

const READ_MOVES = sql`${inboxItemRead.markedUnread} or ${inboxItemRead.readThrough} is null or ${inboxItemRead.readThrough} < ${excluded(inboxItemRead.readThrough)}`;

const ReaderItemSchema = Schema.Struct({ userId: Schema.String, itemId: Schema.String });

const MarkedSchema = Schema.Struct({ itemId: Schema.String, txid: Schema.String });

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
            .where(and(eq(inboxItem.id, itemId), itemVisibleTo(userId))),
        )
        .onConflictDoUpdate({
          target: [inboxItemRead.itemId, inboxItemRead.userId],
          set: READ_ON,
          setWhere: READ_MOVES,
        })
        .returning({ itemId: inboxItemRead.itemId, txid: TXID }),
    ),
});

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
            .where(and(eq(inboxItem.id, itemId), itemVisibleTo(userId))),
        )
        .onConflictDoUpdate({
          target: [inboxItemRead.itemId, inboxItemRead.userId],
          set: { markedUnread: true },
          setWhere: sql`not ${inboxItemRead.markedUnread}`,
        })
        .returning({ itemId: inboxItemRead.itemId, txid: TXID }),
    ),
});

const upsertReminder = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    until: Schema.NullOr(Schema.Date),
  }),
  Result: MarkedSchema,
  execute: ({ userId, itemId, until }) =>
    Database.use((db) =>
      db
        .insert(inboxItemRead)
        .select(
          db
            .select({
              itemId: inboxItem.id,
              userId: sql<string>`${userId}::text`.as(inboxItemRead.userId.name),
              remindAt:
                sql<Date | null>`${until === null ? null : until.toISOString()}::timestamptz`.as(
                  inboxItemRead.remindAt.name,
                ),
              remindThrough: (until === null
                ? sql<Date | null>`null::timestamptz`
                : sql<Date | null>`${inboxItem.updatedAt}`
              ).as(inboxItemRead.remindThrough.name),
            })
            .from(inboxItem)
            .where(and(eq(inboxItem.id, itemId), itemVisibleTo(userId))),
        )
        .onConflictDoUpdate({
          target: [inboxItemRead.itemId, inboxItemRead.userId],
          set:
            until === null
              ? {
                  remindAt: sql`case when ${inboxItemRead.remindAt} is null then null else least(${inboxItemRead.remindAt}, now()) end`,
                }
              : {
                  remindAt: excluded(inboxItemRead.remindAt),
                  remindThrough: excluded(inboxItemRead.remindThrough),
                },
        })
        .returning({ itemId: inboxItemRead.itemId, txid: TXID }),
    ),
});

const findReaderUnread = SqlSchema.findOneOption({
  Request: ReaderItemSchema,
  Result: Schema.Struct({ unread: Schema.Boolean }),
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select({ unread: unreadFor(userId) })
        .from(inboxItem)
        .where(and(eq(inboxItem.id, itemId), itemVisibleTo(userId))),
    ),
});

const findReachedItem = SqlSchema.findOneOption({
  Request: ReaderItemSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, itemId }) =>
    Database.use((db) =>
      db
        .select({ id: inboxItem.id })
        .from(inboxItem)
        .where(and(eq(inboxItem.id, itemId), itemVisibleTo(userId))),
    ),
});

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
            .where(
              and(
                itemVisibleTo(userId),
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
        .returning({ itemId: inboxItemRead.itemId, txid: TXID }),
    ),
});

const answerItem = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    revision: Schema.Number,
    askId: Schema.String,
    answerKey: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String, txid: Schema.String }),
  execute: ({ userId, itemId, revision, askId, answerKey, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.ANSWERED,
          answerKey,
          answeredBy: userId,
          settledAt: now,
          updatedAt: now,
          openAskMessageId: null,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemVisibleTo(userId),
            eq(inboxItem.revision, revision),
            eq(inboxItem.openAskMessageId, askId),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
          ),
        )
        .returning({ id: inboxItem.id, txid: TXID }),
    ),
});

const acknowledgeNotice = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    revision: Schema.Number,
    answerKey: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String, txid: Schema.String }),
  execute: ({ userId, itemId, revision, answerKey, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.ANSWERED,
          answerKey,
          answeredBy: userId,
          settledAt: now,
          openAskMessageId: null,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemVisibleTo(userId),
            eq(inboxItem.revision, revision),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
            NOTICE,
          ),
        )
        .returning({ id: inboxItem.id, txid: TXID }),
    ),
});

function itemAsWritten(
  readerId: string,
  itemId: string,
  keysFor?: string,
): InboxStoreEffect<InboxItem> {
  return findItemOf({ readerId, itemId }).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.catchTag("NoSuchElementError", Effect.die),
    Effect.map((row) => storedItem(row, keysFor).item),
  );
}

function writtenMessage(
  message: typeof MessageWriteSchema.Type,
): InboxStoreEffect<{ readonly id: string }> {
  return insertMessage(message).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.catchTag("NoSuchElementError", Effect.die),
  );
}

type PictureAddress = (pictureId: string) => string;

function withPictureAddresses(
  body: string,
  pictureOfPath: (path: string) => string | undefined,
  addressOf: PictureAddress,
): string {
  return body.replace(
    INBOX_PICTURE_IN_WORDS,
    (whole: string, _alt: string, destination: string, offset: number) => {
      const id = insideCode(body, offset)
        ? undefined
        : pictureOfPath(inboxPictureDestination(destination));
      if (id === undefined) return whole;
      return `${whole.slice(0, whole.length - destination.length)}${addressOf(id)}`;
    },
  );
}

const memberCloseItem = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    revision: Schema.Number,
    closeKey: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String, txid: Schema.String }),
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
            itemVisibleTo(userId),
            eq(inboxItem.revision, revision),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
          ),
        )
        .returning({ id: inboxItem.id, txid: TXID }),
    ),
});

interface PostView {
  readonly title: string;
  readonly needsReply: boolean;
}

interface PostPicture extends InboxNamedImage {
  readonly id: string;
}

export interface InboxBodyPicture extends InboxNamedImage {
  readonly path: string;
}

interface PostWrite {
  readonly key: string;
  readonly view: PostView;
  readonly body: (addressOf: PictureAddress) => string;
  readonly ask: InboxAsk | undefined;
  readonly pictures: readonly PostPicture[];
  readonly addresseeId: string | null;
}

interface LockedWorkspace {
  readonly organizationId: string;
  readonly workspaceStep: string;
}

function itemPlace(agent: InboxAgent, itemId: string): InboxItemPlace {
  return { kind: LINK_PLACE.INBOX_ITEM, agentId: agent.agentId, itemId };
}

function pictureAddressOf(
  agent: InboxAgent,
  workspace: LockedWorkspace,
  itemId: string,
): PictureAddress {
  const place = itemPlace(agent, itemId);
  return (pictureId) => inboxAttachmentAddress(place, pictureId, workspace.workspaceStep);
}

interface PicturesByPath {
  readonly kept: readonly PostPicture[];
  readonly idOf: (path: string) => string | undefined;
}

function picturesByPath(pictures: readonly InboxBodyPicture[]): PicturesByPath {
  const kept = pictures.map(({ path: _path, ...picture }) => ({ ...picture, id: randomUUID() }));
  const ids = new Map<string, string>();
  pictures.forEach((picture, at) => {
    const id = kept[at]?.id;
    if (id !== undefined && !ids.has(picture.path)) ids.set(picture.path, id);
  });
  return { kept, idOf: (path) => ids.get(path) };
}

function postColumns(view: PostView, ask: InboxAsk | undefined) {
  const needsReply = ask === undefined ? false : view.needsReply;
  return { title: view.title, needsReply, status: INBOX_STATUS.OPEN, settledAt: null } as const;
}

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
      ...postColumns(post.view, post.ask),
      addresseeId: post.addresseeId,
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
      addresseeId: post.addresseeId,
      clientKey: null,
      now,
    });
    yield* settleOpenAsks({
      itemId,
      except: message.id,
      status: INBOX_ASK_STATUS.REPLACED,
      withdrawnReason: null,
      withdrawnAt: null,
    });
    if (ask !== null) yield* holdAsk({ itemId, messageId: message.id });
    yield* writeMessageFiles(
      post.pictures.map((picture, position) => ({
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
      })),
    );
    return yield* itemAsWritten(agent.userId, itemId);
  });
}

function roomToAsk(agent: InboxAgent, key: string): InboxStoreEffect<boolean> {
  return countOpenBesides({ ...agent, key }).pipe(
    Effect.catchTag("NoSuchElementError", Effect.die),
    Effect.map(({ open }) => open < INBOX_BOUNDS.MAX_OPEN_PER_AGENT),
  );
}

function roomToNotify(agent: InboxAgent, key: string): InboxStoreEffect<boolean> {
  return countNoticesBesides({ ...agent, key }).pipe(
    Effect.catchTag("NoSuchElementError", Effect.die),
    Effect.map(({ open }) => open < INBOX_BOUNDS.MAX_OPEN_PER_AGENT),
  );
}

function roomToPost(
  agent: InboxAgent,
  key: string,
  ask: InboxAsk | undefined,
): InboxStoreEffect<Result.Result<void, InboxPostRefusal>> {
  return ask === undefined
    ? Effect.map(roomToNotify(agent, key), (room) =>
        room ? Result.void : Result.fail(INBOX_POST_REFUSAL.TOO_MANY_NOTICES),
      )
    : Effect.map(roomToAsk(agent, key), (room) =>
        room ? Result.void : Result.fail(INBOX_POST_REFUSAL.TOO_MANY_OPEN),
      );
}

interface InboxThreadPost {
  readonly key: string;
  readonly title?: string | undefined;
  readonly body: string;
  readonly ask?: InboxAsk | undefined;
  readonly needsReply?: boolean | undefined;
  readonly addresseeId?: string | undefined;
}

function placeOf(
  agent: InboxAgent,
  locked: LockedWorkspace,
  post: InboxThreadPost,
): InboxStoreEffect<Result.Result<{ readonly addresseeId: string | null }, InboxPostRefusal>> {
  return Effect.gen(function* () {
    const { organizationId } = locked;
    if (post.addresseeId !== undefined) {
      const member = yield* isWorkspaceMember(post.addresseeId, organizationId);
      if (!member) return Result.fail(INBOX_POST_REFUSAL.NO_ADDRESSEE);
      const sees = yield* findReachedAgent({ userId: post.addresseeId, agentId: agent.agentId });
      if (Option.isNone(sees)) return Result.fail(INBOX_POST_REFUSAL.ADDRESSEE_CANNOT_SEE);
    }
    return Result.succeed({ addresseeId: post.addresseeId ?? null });
  });
}

const updateItemAddressee = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, addresseeId: Schema.String }),
  execute: ({ itemId, addresseeId }) =>
    Database.use((db) => db.update(inboxItem).set({ addresseeId }).where(eq(inboxItem.id, itemId))),
});

function replaceItem(
  itemId: string,
  place: { readonly addresseeId: string | null },
): InboxStoreEffect<void> {
  return place.addresseeId === null
    ? Effect.void
    : updateItemAddressee({ itemId, addresseeId: place.addresseeId });
}

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
    const writer = {
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      addresseeId: post.addresseeId ?? null,
    } as const;
    return writeInboxMessage(agent.userId, itemId, writer, text, kept);
  }).pipe(
    Effect.flatMap(Effect.fromOption),
    Effect.catchTag("NoSuchElementError", Effect.die),
    Effect.map((written) => written.item),
  );
}

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
        const placed = yield* placeOf(agent, locked.value, post);
        if (Result.isFailure(placed)) return Result.fail(placed.failure);
        if (post.ask === undefined && Option.isSome(standing) && standing.value.asking) {
          const itemId = standing.value.id;
          yield* replaceItem(itemId, placed.success);
          return Result.succeed(yield* followUp(agent, locked.value, itemId, post, pictures));
        }
        const title = post.title ?? Option.getOrUndefined(standing)?.title;
        if (title === undefined) return Result.fail(INBOX_POST_REFUSAL.NO_TITLE);
        const room = yield* roomToPost(agent, post.key, post.ask);
        if (Result.isFailure(room)) return Result.fail(room.failure);
        const now = yield* DateTime.nowAsDate;
        const { kept, idOf } = yield* Effect.sync(() => picturesByPath(pictures));
        const view = { title, needsReply: post.needsReply ?? true };
        const body = (addressOf: PictureAddress) =>
          withPictureAddresses(post.body, idOf, addressOf);
        const write = {
          key: post.key,
          view,
          body,
          ask: post.ask,
          pictures: kept,
          ...placed.success,
        };
        return Result.succeed(yield* keepPost(agent, locked.value, write, now));
      }),
    ),
  );
}

export function readInboxAttachment(
  userId: string,
  itemId: string,
  attachmentId: string,
): InboxStoreEffect<Option.Option<InboxFile>> {
  return findAttachment({ userId, itemId, attachmentId });
}

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
          withdrawnAt: now.getTime(),
        });
        return Option.some(yield* itemAsWritten(agent.userId, itemId));
      }),
    ),
  );
}

export function agentInboxItems(
  agent: Pick<InboxAgent, "userId" | "agentId">,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId: agent.userId, scope: INBOX_SCOPE.AGENT, id: agent.agentId },
    INBOX_BOUNDS.MAX_SETTLED_TOLD,
  );
}

export function taskInboxItems(
  userId: string,
  taskId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId, scope: INBOX_SCOPE.TASK, id: taskId },
    INBOX_BOUNDS.MAX_ITEMS_READ,
    userId,
  );
}

export function memberAgentInboxItems(
  userId: string,
  agentId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId },
    INBOX_BOUNDS.MAX_ITEMS_READ,
    userId,
  );
}

export function workspaceInboxItems(
  userId: string,
  workspaceId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId, scope: INBOX_SCOPE.WORKSPACE, id: workspaceId },
    INBOX_BOUNDS.MAX_SETTLED_TOLD,
  );
}

export function memberAgentInboxStamps(
  userId: string,
  agentId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  return scopeStamps({ userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId });
}

export function taskInboxStamps(
  userId: string,
  taskId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  return scopeStamps({ userId, scope: INBOX_SCOPE.TASK, id: taskId });
}

function scopeStamps(scope: InboxScope): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(
    Effect.all(
      [findOpenStamps(scope), findSettledStamps({ ...scope, limit: INBOX_BOUNDS.MAX_ITEMS_READ })],
      { concurrency: 2 },
    ),
    ([open, settled]) =>
      [...open, ...settled].map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

function askingReader(userId: string): SQL<boolean> {
  return sql<boolean>`(${ASKING} and ${WAITS_ON} = ${userId})`;
}

export function readInboxItem(
  userId: string,
  itemId: string,
): InboxStoreEffect<Option.Option<StoredInboxItem>> {
  return Effect.map(
    findItem({ userId, itemId }),
    Option.map((row) => storedItem(row, userId)),
  );
}

export function readInboxItemHome(
  userId: string,
  itemId: string,
): InboxStoreEffect<Option.Option<InboxItemHome>> {
  return findItemHome({ userId, itemId });
}

function markerFound(
  marked: Option.Option<typeof MarkedSchema.Type>,
  request: typeof ReaderItemSchema.Type,
): InboxStoreEffect<InboxMarked | false> {
  if (Option.isSome(marked)) return Effect.succeed({ txid: marked.value.txid });
  return Effect.map(findReachedItem(request), (found) => (Option.isSome(found) ? {} : false));
}

export function markInboxItemRead(
  userId: string,
  itemId: string,
): InboxStoreEffect<InboxMarked | false> {
  const request = { userId, itemId };
  return Effect.flatMap(upsertRead(request), (marked) => markerFound(marked, request));
}

export function markInboxItemUnread(
  userId: string,
  itemId: string,
): InboxStoreEffect<InboxMarked | false> {
  const request = { userId, itemId };
  return Effect.flatMap(upsertUnread(request), (marked) => markerFound(marked, request));
}

export function remindInboxItem(
  userId: string,
  itemId: string,
  until: Date | null,
): InboxStoreEffect<(InboxMarked & { readonly unread: boolean }) | false> {
  const request = { userId, itemId };
  return Effect.gen(function* () {
    const marked = yield* markerFound(yield* upsertReminder({ ...request, until }), request);
    if (marked === false) return false;
    const read = yield* findReaderUnread(request);
    return { ...marked, unread: Option.isSome(read) && read.value.unread };
  });
}

export function markInboxRead(
  userId: string,
  workspaceId: string | undefined,
): InboxStoreEffect<InboxMarked & { readonly marked: number }> {
  return Effect.map(upsertAllRead({ userId, workspaceId: workspaceId ?? null }), (marked) => {
    const [first] = marked;
    return first === undefined ? { marked: 0 } : { marked: marked.length, txid: first.txid };
  });
}

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
          answerKey: null,
          answeredBy: null,
          settledAt: null,
          updatedAt: now,
          openAskMessageId: openAsk,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemVisibleTo(userId),
            eq(inboxItem.answerKey, answerKey),
            eq(inboxItem.status, INBOX_STATUS.ANSWERED),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

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
            withdrawnAt: null,
          });
          yield* deleteMessage({ itemId, clientKey: answerKey });
        }
        yield* upsertRead({ userId, itemId });
        return Option.map(
          yield* findItem({ userId, itemId }),
          (row) => storedItem(row, userId).item,
        );
      }),
    ),
  );
}

export function closeInboxItemAsMember(
  userId: string,
  itemId: string,
  revision: number,
  closeKey: string,
  note: { readonly text: string; readonly files: readonly AgentAttachment[] } = {
    text: "",
    files: [],
  },
): InboxStoreEffect<Option.Option<InboxItemWritten>> {
  const noted = note.text !== "" || note.files.length > 0;
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        if (yield* keyTaken(itemId, closeKey)) return Option.none();
        const closed = yield* memberCloseItem({ userId, itemId, revision, closeKey, now });
        if (Option.isNone(closed)) return Option.none();
        if (noted) {
          yield* keepMemberMessage({
            userId,
            itemId,
            clientKey: closeKey,
            words: note.text,
            files: note.files,
            answers: null,
            now,
          });
        }
        yield* settleOpenAsks({
          itemId,
          except: null,
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: null,
          withdrawnAt: now.getTime(),
        });
        yield* upsertRead({ userId, itemId });
        const { txid } = closed.value;
        return Option.map(yield* findItem({ userId, itemId }), (row) => ({
          ...storedItem(row, userId).item,
          txid,
        }));
      }),
    ),
  );
}

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
            itemVisibleTo(userId),
            eq(inboxItem.answerKey, closeKey),
            eq(inboxItem.status, INBOX_STATUS.CLOSED),
            isNull(inboxItem.closedReason),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

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

function askTheCloseWithdrew(itemId: string): InboxStoreEffect<string | null> {
  return Effect.map(findLatestAsk({ itemId }), (latest) =>
    Option.isSome(latest) &&
    latest.value.ask.status === INBOX_ASK_STATUS.WITHDRAWN &&
    latest.value.ask.withdrawnReason === undefined
      ? latest.value.id
      : null,
  );
}

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
        yield* deleteMessage({ itemId, clientKey: closeKey });
        if (openAsk !== null) {
          yield* standAsk({
            messageId: openAsk,
            status: INBOX_ASK_STATUS.OPEN,
            withdrawnReason: null,
            withdrawnAt: null,
          });
        }
        yield* upsertRead({ userId, itemId });
        return Option.map(
          yield* findItem({ userId, itemId }),
          (row) => storedItem(row, userId).item,
        );
      }),
    ),
  );
}

function bytesOf(file: AgentAttachment): Uint8Array {
  return new Uint8Array(Buffer.from(file.data, "base64"));
}

interface AnswerWrite {
  readonly userId: string;
  readonly itemId: string;
  readonly answerKey: string;
  readonly words: string;
  readonly files: readonly AgentAttachment[];
  readonly askId: string;
  readonly answers: InboxAnswers;
  readonly now: Date;
}

function answeringMessage(
  message: typeof MessageWriteSchema.Type,
): InboxStoreEffect<Option.Some<{ readonly id: string }>> {
  return insertMessage(message).pipe(
    Effect.flatMap((written) =>
      Option.isSome(written)
        ? Effect.succeed(written)
        : Effect.die(new Error("a message took the key while it was written")),
    ),
  );
}

function keepMemberMessage(write: {
  readonly userId: string;
  readonly itemId: string;
  readonly clientKey: string;
  readonly words: string;
  readonly files: readonly AgentAttachment[];
  readonly answers: InboxAnswers | null;
  readonly now: Date;
}): InboxStoreEffect<void> {
  return Effect.gen(function* () {
    const { itemId, now } = write;
    const written = yield* answeringMessage({
      itemId,
      author: INBOX_MESSAGE_AUTHOR.MEMBER,
      userId: write.userId,
      text: write.words,
      ask: null,
      answers: write.answers,
      addresseeId: null,
      clientKey: write.clientKey,
      now,
    });
    if (write.files.length === 0) return;
    const scope = yield* itemScope({ itemId });
    yield* writeMessageFiles(
      write.files.map((file, position) => ({
        ...scope,
        itemId,
        messageId: written.value.id,
        name: file.name,
        position,
        contentType: file.mediaType,
        bytes: bytesOf(file),
        now,
      })),
    );
  });
}

function keepAnswer(write: AnswerWrite): InboxStoreEffect<void> {
  return Effect.andThen(
    standAsk({
      messageId: write.askId,
      status: INBOX_ASK_STATUS.ANSWERED,
      withdrawnReason: null,
      withdrawnAt: null,
    }),
    keepMemberMessage({ ...write, clientKey: write.answerKey }),
  );
}

function keyTaken(itemId: string, clientKey: string): InboxStoreEffect<boolean> {
  return Effect.map(findKeyedMessage({ itemId, clientKey }), Option.isSome);
}

export function acknowledgeInboxItem(
  userId: string,
  itemId: string,
  revision: number,
  answerKey: string,
): InboxStoreEffect<Option.Option<InboxItemWritten>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        if (yield* keyTaken(itemId, answerKey)) return Option.none();
        const nodded = yield* acknowledgeNotice({ userId, itemId, revision, answerKey, now });
        if (Option.isNone(nodded)) return Option.none();
        yield* upsertRead({ userId, itemId });
        const { txid } = nodded.value;
        return Option.map(yield* findItem({ userId, itemId }), (row) => ({
          ...storedItem(row, userId).item,
          txid,
        }));
      }),
    ),
  );
}

export const INBOX_ASK_ANSWER = {
  TAKEN: "taken",
  REPEATED: "repeated",
  NOT_OPEN: "not-open",
  REFUSED: "refused",
} as const;

type InboxAskAnswer = (typeof INBOX_ASK_ANSWER)[keyof typeof INBOX_ASK_ANSWER];

const KEY_NAMES_ANOTHER_MESSAGE = "The key names another message of the thread.";

interface InboxAskAnswered {
  readonly item: InboxItem;
  readonly outcome: InboxAskAnswer;
  readonly refusal?: string;
  readonly ask?: InboxAsk;
  readonly txid?: string;
}

export function answerInboxAsk(
  userId: string,
  itemId: string,
  sent: {
    readonly answers: InboxAnswers;
    readonly text: string;
    readonly clientKey: string;
    readonly files?: readonly AgentAttachment[] | undefined;
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
            item: storedItem(found.value, userId).item,
            outcome,
            ...(refusal === undefined ? undefined : { refusal }),
          });
        const keyed = yield* findKeyedMessage({ itemId, clientKey: sent.clientKey });
        if (Option.isSome(keyed)) {
          const resent =
            found.value.answerKey === sent.clientKey &&
            sameAnswers(keyed.value.answers, sent.answers) &&
            sameMessage(keyed.value, {
              userId,
              text: sent.text,
              files: files.map((file) => ({ name: file.name, contentType: file.mediaType })),
            });
          return resent
            ? standing(INBOX_ASK_ANSWER.REPEATED)
            : standing(INBOX_ASK_ANSWER.REFUSED, KEY_NAMES_ANOTHER_MESSAGE);
        }
        if (found.value.answerKey === sent.clientKey) {
          return standing(INBOX_ASK_ANSWER.REFUSED, KEY_NAMES_ANOTHER_MESSAGE);
        }
        const asking = yield* findOpenAsk({ userId, itemId });
        if (Option.isNone(asking) || asking.value.id !== sent.answers.ask) {
          return standing(INBOX_ASK_ANSWER.NOT_OPEN);
        }
        const ask = knownAsk(asking.value.ask);
        const refusal =
          ask === undefined
            ? "The ask is one this version does not know."
            : inboxAnswersRefusal(ask, sent.answers, sent.text, files);
        if (refusal !== undefined) return standing(INBOX_ASK_ANSWER.REFUSED, refusal);
        const now = yield* DateTime.nowAsDate;
        const answered = yield* answerItem({
          userId,
          itemId,
          revision: found.value.revision,
          askId: asking.value.id,
          answerKey: sent.clientKey,
          now,
        });
        if (Option.isNone(answered)) return standing(INBOX_ASK_ANSWER.NOT_OPEN);
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
        const item = yield* itemAsWritten(userId, itemId, userId);
        return Option.some({
          item,
          outcome: INBOX_ASK_ANSWER.TAKEN,
          txid: answered.value.txid,
          ...(ask === undefined ? undefined : { ask }),
        });
      }),
    ),
  );
}

type InboxMessageWriter =
  | {
      readonly author: typeof INBOX_MESSAGE_AUTHOR.MEMBER;
      readonly userId: string;
      readonly clientKey: string;
      readonly revision?: number | undefined;
    }
  | {
      readonly author: typeof INBOX_MESSAGE_AUTHOR.AGENT;
      readonly addresseeId: string | null;
    };

export const INBOX_MESSAGE_OUTCOME = {
  WRITTEN: "written",
  REPEATED: "repeated",
  KEY_REUSED: "key-reused",
} as const;

type InboxMessageOutcome = (typeof INBOX_MESSAGE_OUTCOME)[keyof typeof INBOX_MESSAGE_OUTCOME];

export interface InboxMessageWritten {
  readonly item: InboxItem;
  readonly outcome: InboxMessageOutcome;
}

const KeyedMessageSchema = Schema.Struct({
  userId: Schema.NullOr(Schema.String),
  text: Schema.String,
  files: Schema.Array(Schema.Struct({ name: Schema.String, mediaType: Schema.String })),
  answers: Schema.NullOr(inboxAnswersSchema),
});

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
          answers: inboxMessage.answers,
        })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.itemId, itemId), eq(inboxMessage.clientKey, clientKey))),
    ),
});

function sameList<T>(
  standing: readonly T[] | undefined,
  sent: readonly T[] | undefined,
  same: (left: T, right: T) => boolean = (left, right) => left === right,
): boolean {
  const left = standing ?? [];
  const right = sent ?? [];
  return (
    left.length === right.length &&
    left.every((each, at) => {
      const other = right[at];
      return other !== undefined && same(each, other);
    })
  );
}

function sameAnswers(standing: InboxAnswers | null, sent: InboxAnswers): boolean {
  return (
    standing !== null &&
    standing.ask === sent.ask &&
    standing.reply === sent.reply &&
    sameList(standing.choices, sent.choices) &&
    sameList(standing.steps, sent.steps) &&
    sameList(
      standing.values,
      sent.values,
      (left, right) => left.label === right.label && left.value === right.value,
    )
  );
}

function sameMessage(
  standing: typeof KeyedMessageSchema.Type,
  sent: {
    readonly userId: string;
    readonly text: string;
    readonly files: readonly Pick<MessageFile, "name" | "contentType">[];
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
          addresseeId: writer.author === INBOX_MESSAGE_AUTHOR.AGENT ? writer.addresseeId : null,
          clientKey: member?.clientKey ?? null,
          now,
        });
        if (Option.isSome(written)) {
          const scope = yield* itemScope({ itemId });
          yield* writeMessageFiles(
            files.map((file, position) => ({
              ...scope,
              itemId,
              messageId: written.value.id,
              ...file,
              position,
              now,
            })),
          );
          yield* touchItem({ itemId, now });
          if (member !== undefined) {
            yield* upsertRead({ userId: member.userId, itemId });
            const { userId, clientKey: answerKey, revision } = member;
            if (revision !== undefined) {
              yield* acknowledgeNotice({ userId, itemId, revision, answerKey, now });
            }
          }
        }
        const outcome = Option.isSome(written)
          ? INBOX_MESSAGE_OUTCOME.WRITTEN
          : yield* repeatOutcome(itemId, member, text, files);
        const found = yield* findItemOf({ readerId, itemId });
        return Option.map(found, (row) => ({
          item: storedItem(row, member?.userId).item,
          outcome,
        }));
      }),
    ),
  );
}

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

export function postInboxMessage(
  userId: string,
  itemId: string,
  message: {
    readonly text: string;
    readonly clientKey: string;
    readonly files?: readonly AgentAttachment[] | undefined;
    readonly revision?: number | undefined;
  },
): InboxStoreEffect<Option.Option<InboxMessageWritten>> {
  const { clientKey, revision } = message;
  return Effect.flatMap(findItem({ userId, itemId }), (found) =>
    Option.isNone(found)
      ? Effect.succeed(Option.none())
      : writeInboxMessage(
          userId,
          itemId,
          { author: INBOX_MESSAGE_AUTHOR.MEMBER, userId, clientKey, revision },
          message.text,
          (message.files ?? []).map((file) => ({
            name: file.name,
            contentType: file.mediaType,
            bytes: bytesOf(file),
          })),
        ),
  );
}

const KEY_STEM_CHARS = INBOX_BOUNDS.MAX_KEY_CHARS - 8;

const KEY_STEM_FALLBACK = "thread";

function keyStem(title: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .slice(0, KEY_STEM_CHARS)
    .replace(/^-+|-+$/gu, "");
  return stem === "" ? KEY_STEM_FALLBACK : stem;
}

function freeKey(stem: string, taken: ReadonlySet<string>): string {
  if (!taken.has(stem)) return stem;
  let next = 2;
  while (taken.has(`${stem}-${next}`)) next += 1;
  return `${stem}-${next}`;
}

const findStemKeys = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String, stem: Schema.String }),
  Result: Schema.Struct({ key: Schema.String }),
  execute: ({ agentId, stem }) =>
    Database.use((db) =>
      db
        .select({ key: inboxItem.key })
        .from(inboxItem)
        .where(
          and(
            eq(inboxItem.agentId, agentId),
            or(eq(inboxItem.key, stem), like(inboxItem.key, `${stem}-%`)),
          ),
        ),
    ),
});

const findReachedAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentVisibleTo(userId))),
    ),
});

const findStartedThread = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    clientKey: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId, clientKey }) =>
    Database.use((db) =>
      db
        .select({ id: inboxItem.id })
        .from(inboxItem)
        .innerJoin(inboxMessage, eq(inboxMessage.itemId, inboxItem.id))
        .where(
          and(
            eq(inboxItem.agentId, agentId),
            eq(inboxMessage.author, INBOX_MESSAGE_AUTHOR.MEMBER),
            eq(inboxMessage.userId, userId),
            eq(inboxMessage.clientKey, clientKey),
            eq(inboxMessage.createdAt, inboxItem.postedAt),
          ),
        )
        .limit(1),
    ),
});

const insertStartedItem = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.NullOr(Schema.String),
    organizationId: Schema.String,
    agentId: Schema.String,
    key: Schema.String,
    title: Schema.String,
    memberId: Schema.String,
    clientKey: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ memberId, clientKey, now, ...item }) =>
    Database.use((db) =>
      db
        .insert(inboxItem)
        .values({
          ...item,
          revision: 1,
          version: INBOX_WIRE_VERSION,
          needsReply: false,
          status: INBOX_STATUS.ANSWERED,
          answerKey: clientKey,
          answeredBy: memberId,
          postedAt: now,
          settledAt: now,
          updatedAt: now,
        })
        .returning({ id: inboxItem.id }),
    ),
});

const deleteStartedItem = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, clientKey: Schema.String }),
  execute: ({ itemId, clientKey }) =>
    Database.use((db) => {
      const first = db
        .select({ one: inboxMessage.id })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.itemId, itemId), eq(inboxMessage.clientKey, clientKey)));
      const other = db
        .select({ one: inboxMessage.id })
        .from(inboxMessage)
        .where(
          and(
            eq(inboxMessage.itemId, itemId),
            or(isNull(inboxMessage.clientKey), ne(inboxMessage.clientKey, clientKey)),
          ),
        );
      return db
        .delete(inboxItem)
        .where(and(eq(inboxItem.id, itemId), exists(first), notExists(other)));
    }),
});

export function startInboxThread(
  userId: string,
  agent: InboxAgent,
  thread: {
    readonly title: string;
    readonly text: string;
    readonly clientKey: string;
    readonly files?: readonly AgentAttachment[] | undefined;
  },
): InboxStoreEffect<Option.Option<InboxMessageWritten>> {
  const { title, text, clientKey } = thread;
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const reached = yield* findReachedAgent({ userId, agentId: agent.agentId });
        if (Option.isNone(reached)) return Option.none();
        const locked = yield* lockAgent(agent);
        if (Option.isNone(locked)) return Option.none();
        const files = (thread.files ?? []).map((file) => ({
          name: file.name,
          contentType: file.mediaType,
          bytes: bytesOf(file),
        }));
        const started = yield* findStartedThread({ userId, agentId: agent.agentId, clientKey });
        if (Option.isSome(started)) {
          const item = yield* itemAsWritten(userId, started.value.id, userId);
          const first = yield* findKeyedMessage({ itemId: item.id, clientKey });
          const same = Option.isSome(first) && sameMessage(first.value, { userId, text, files });
          const outcome = same ? INBOX_MESSAGE_OUTCOME.REPEATED : INBOX_MESSAGE_OUTCOME.KEY_REUSED;
          return Option.some({ item, outcome });
        }
        const stem = keyStem(title);
        const taken = yield* findStemKeys({ agentId: agent.agentId, stem });
        const key = freeKey(stem, new Set(taken.map((row) => row.key)));
        const now = yield* DateTime.nowAsDate;
        const { organizationId } = locked.value;
        const { id: itemId } = yield* insertStartedItem({
          ...agent,
          organizationId,
          key,
          title,
          memberId: userId,
          clientKey,
          now,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        const message = yield* writtenMessage({
          itemId,
          author: INBOX_MESSAGE_AUTHOR.MEMBER,
          userId,
          text,
          ask: null,
          answers: null,
          addresseeId: null,
          clientKey,
          now,
        });
        yield* writeMessageFiles(
          files.map((file, position) => ({
            userId: agent.userId,
            taskId: agent.taskId,
            organizationId,
            itemId,
            messageId: message.id,
            ...file,
            position,
            now,
          })),
        );
        yield* upsertRead({ userId, itemId });
        const item = yield* itemAsWritten(userId, itemId, userId);
        return Option.some({ item, outcome: INBOX_MESSAGE_OUTCOME.WRITTEN });
      }),
    ),
  );
}

const retitleItem = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, standing: Schema.String, title: Schema.String }),
  execute: ({ itemId, standing, title }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({ title, revision: sql`${inboxItem.revision} + 1` })
        .where(and(eq(inboxItem.id, itemId), eq(inboxItem.title, standing))),
    ),
});

export function retitleInboxThread(
  itemId: string,
  standing: string,
  title: string,
): InboxStoreEffect<void> {
  return title === standing ? Effect.void : retitleItem({ itemId, standing, title });
}

export function withdrawInboxThread(
  userId: string,
  itemId: string,
  clientKey: string,
): InboxStoreEffect<void> {
  return Effect.flatMap(findItem({ userId, itemId }), (found) =>
    Option.isNone(found) ? Effect.void : deleteStartedItem({ itemId, clientKey }),
  );
}

const findAgentItem = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...AgentKeySchema.fields, key: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, title: Schema.String, asking: Schema.Boolean }),
  execute: ({ userId, agentId, key }) =>
    Database.use((db) =>
      db
        .select({ id: inboxItem.id, title: inboxItem.title, asking: ASKING })
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
            { author: INBOX_MESSAGE_AUTHOR.AGENT, addresseeId: null },
            text,
            pictures,
          ),
          Option.map((written) => written.item),
        ),
  );
}

export function withdrawInboxMessage(
  userId: string,
  itemId: string,
  clientKey: string,
): InboxStoreEffect<void> {
  const withdrawn = Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* withdrawAnswer({ userId, itemId, answerKey: clientKey, openAsk: null, now });
    yield* deleteMessage({ itemId, clientKey });
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    Effect.flatMap(findItem({ userId, itemId }), (found) =>
      Option.isNone(found) ? Effect.void : client.withTransaction(withdrawn),
    ),
  );
}

type AccountWaitingRow = AccountInboxEntry & Pick<InboxStamp, "status">;

export function accountWaitingItems(
  userId: string,
): InboxStoreEffect<readonly AccountWaitingRow[]> {
  return Effect.map(findWaitingItems({ userId }), (rows) =>
    rows.map(({ taskId, ...row }) => ({
      ...row,
      snoozedUntil: row.remindAt,
      planId: taskId,
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

type AccountTasklessRow = AccountTasklessEntry & Pick<InboxStamp, "status">;

export function accountTasklessItems(
  userId: string,
  repositoryless: boolean,
): InboxStoreEffect<readonly AccountTasklessRow[]> {
  return Effect.map(findTasklessWaitingItems({ userId, repositoryless }), (rows) =>
    rows.map(({ workspaceId, ...row }) => ({
      ...row,
      snoozedUntil: row.remindAt,
      ...(workspaceId === null ? undefined : { workspaceId }),
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

export function accountWaitingStamps(userId: string): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(findWaitingStamps({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

export function accountInboxTasks(userId: string): InboxStoreEffect<readonly AccountInboxTask[]> {
  return Effect.map(findTasksWithItems({ userId }), (rows) =>
    rows.map(({ taskId, ...row }) => ({
      ...row,
      planId: taskId,
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

export function accountInboxAutomations(
  userId: string,
): InboxStoreEffect<readonly AccountInboxAutomation[]> {
  return Effect.map(findAutomationsWithItems({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

export function accountInboxAgents(
  userId: string,
  repositoryless: boolean,
): InboxStoreEffect<readonly AccountInboxAgent[]> {
  return Effect.map(findAgentsWithItems({ userId, repositoryless }), (rows) =>
    rows.map(({ workspaceId, ...row }) => ({
      ...row,
      ...(workspaceId === null ? undefined : { workspaceId }),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}
