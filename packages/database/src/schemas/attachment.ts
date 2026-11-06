import { AGENT_BOUNDS, type AgentAttachmentType } from "@repo/features/agent-wire";
import {
  CONVERSATION_MEDIA_TYPE,
  CONVERSATION_PICTURE_BOUNDS,
  type ConversationMediaType,
} from "@repo/features/conversation-picture-wire";
import { INBOX_BOUNDS } from "@repo/features/inbox-wire";
import { PICTURE_BOUNDS } from "@repo/features/picture-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { INBOX_ATTACHMENT_KIND, type InboxAttachmentKind } from "../storage-vocabulary.js";
import { bytea, timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { inboxItem } from "./inbox.js";
import { inboxMessage } from "./inbox-message.js";
import { descriptionComment } from "./description-comment.js";
import { conversations } from "./storage.js";
import { task } from "./task.js";

const literal = (value: string) => sql.raw(`'${value}'`);
const bound = (bytes: number) => sql.raw(String(bytes));

const isWebm = (table: { readonly contentType: AnyPgColumn }) =>
  sql`${table.contentType} = ${literal(CONVERSATION_MEDIA_TYPE.WEBM)}`;

const ownerColumns = (table: {
  readonly inboxItemId: AnyPgColumn;
  readonly conversationId: AnyPgColumn;
  readonly descriptionCommentId: AnyPgColumn;
}) => [table.inboxItemId, table.conversationId, table.descriptionCommentId];

export const ownedByTaskAlone = (table: {
  readonly taskId: AnyPgColumn;
  readonly inboxItemId: AnyPgColumn;
  readonly conversationId: AnyPgColumn;
  readonly descriptionCommentId: AnyPgColumn;
}) =>
  sql`(${table.taskId} is not null and num_nonnulls(${sql.join(ownerColumns(table), sql`, `)}) = 0)`;

export const attachment = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    inboxItemId: uuid("inbox_item_id").references(() => inboxItem.id, { onDelete: "cascade" }),
    inboxMessageId: uuid("inbox_message_id").references(() => inboxMessage.id, {
      onDelete: "cascade",
    }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    descriptionCommentId: uuid("description_comment_id").references(() => descriptionComment.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").$type<InboxAttachmentKind>(),
    name: text("name"),
    position: integer("position"),
    contentType: text("content_type")
      .$type<AgentAttachmentType | ConversationMediaType>()
      .notNull(),
    sha256: text("sha256"),
    width: integer("width"),
    height: integer("height"),
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    savedAt: timestamptz("saved_at"),
  },
  (table) => [
    index("attachment_inbox_item")
      .on(table.inboxItemId)
      .where(sql`${table.inboxItemId} is not null`),
    index("attachment_inbox_message")
      .on(table.inboxMessageId)
      .where(sql`${table.inboxMessageId} is not null`),
    index("attachment_description_comment")
      .on(table.descriptionCommentId)
      .where(sql`${table.descriptionCommentId} is not null`),
    uniqueIndex("attachment_conversation_sha256").on(table.conversationId, table.sha256),
    index("attachment_task").on(table.taskId).where(sql`${table.taskId} is not null`),
    index("attachment_unsaved")
      .on(table.createdAt)
      .where(sql`${ownedByTaskAlone(table)} and ${table.savedAt} is null`),
    check(
      "attachment_one_owner",
      sql`(num_nonnulls(${sql.join(ownerColumns(table), sql`, `)}) = 1 or ${ownedByTaskAlone(table)}) and (${table.inboxMessageId} is null or ${table.inboxItemId} is not null)`,
    ),
    check(
      "attachment_bytes_bound",
      sql`(${table.conversationId} is null or octet_length(${table.bytes}) <= ${bound(CONVERSATION_PICTURE_BOUNDS.MAX_BYTES)}) and (not ${ownedByTaskAlone(table)} or octet_length(${table.bytes}) <= ${bound(PICTURE_BOUNDS.MAX_BYTES)} or (${isWebm(table)} and octet_length(${table.bytes}) <= ${bound(PICTURE_BOUNDS.MAX_VIDEO_BYTES)}))`,
    ),
    check(
      "attachment_description_comment_file",
      sql`${table.descriptionCommentId} is null or (${table.taskId} is not null and ${table.organizationId} is not null and ${table.name} is not null and ${table.position} is not null and octet_length(${table.bytes}) <= ${bound(AGENT_BOUNDS.MAX_PDF_BYTES)})`,
    ),
    check(
      "attachment_conversation_picture",
      sql`${table.conversationId} is null or (${table.sha256} is not null and ${table.width} is not null and ${table.height} is not null)`,
    ),
    check(
      "attachment_inbox_kind",
      sql`(${table.inboxItemId} is null and ${table.kind} is null) or (${table.inboxItemId} is not null and ((${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.IMAGE)} and octet_length(${table.bytes}) <= ${bound(INBOX_BOUNDS.MAX_IMAGE_BYTES)} and ${table.name} is null and ${table.position} is null and ${table.inboxMessageId} is null) or (${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.ANSWER)} and octet_length(${table.bytes}) <= ${bound(AGENT_BOUNDS.MAX_PDF_BYTES)} and ${table.name} is not null and ${table.position} is not null and ${table.inboxMessageId} is null) or (${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.MESSAGE)} and (octet_length(${table.bytes}) <= ${bound(AGENT_BOUNDS.MAX_PDF_BYTES)} or (${isWebm(table)} and octet_length(${table.bytes}) <= ${bound(INBOX_BOUNDS.MAX_VIDEO_BYTES)})) and ${table.name} is not null and ${table.position} is not null and ${table.inboxMessageId} is not null)))`,
    ),
  ],
);
