import { CHAT_BOUNDS } from "@luke/features/chat-wire";
import {
  CODING_AGENT_BOUNDS,
  type CodingAgentAttachmentType,
} from "@luke/features/coding-agent-wire";
import { INBOX_BOUNDS } from "@luke/features/inbox-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { INBOX_ATTACHMENT_KIND, type InboxAttachmentKind } from "../storage-vocabulary.js";
import { bytea, timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { chatMessage } from "./chat.js";
import { inboxItem } from "./inbox.js";
import { inboxMessage } from "./inbox-message.js";
import { task } from "./task.js";

/** A value written into a check as SQL rather than a parameter, which a constraint cannot take. */
const literal = (value: string) => sql.raw(`'${value}'`);
const bound = (bytes: number) => sql.raw(String(bytes));

/**
 * attachment.ts -- one file Luke keeps for something it belongs to: its bytes, kept beside the row that owns it, whatever kind of row that is.
 *
 * Every attachment, of every owner, is a row of this one table. Its owner is
 * named by one foreign key column per kind of owner, and exactly one of
 * them stands on a row (`attachment_one_owner`), so a row goes with its
 * owner by the owner's own cascade, as it did when each owner kept a table
 * of its own, and a new kind of owner is one more nullable column, one more
 * term of the check, and one more partial index.
 *
 * The owners move here one at a time from the tables they kept their own
 * in (`chat_attachment`, `inbox_attachment`, `plan_attachment`,
 * `conversation_attachment`). Each move copies the old table's rows here
 * under their ids, drops the table or renames it out of the way (a drop
 * locks every table its foreign keys name, which a rename does not), and
 * leaves a view over this one under
 * its name and its columns' names, so a run still on a deployment from
 * before the move reads and writes the rows it always did; a later
 * migration drops the view once those runs have drained. A chat message's
 * pictures moved first, and an inbox item's files second: `chat_attachment`
 * and `inbox_attachment` are those views.
 *
 * An inbox item's file is a picture of an image block's, a file the
 * developer's answer carried, or a file a message on the item's thread
 * carried, which names that message beside its item; its kind says which,
 * and only an answer's or a message's file has a name and a place among its
 * files. Its account and its task stand on the row as they did on the
 * table it moved from, though the item it goes with goes with either.
 *
 * The bytes stand in the row itself, as every owner's did: this deployment
 * keeps no blob store, and each owner holds its bytes to its own bound, a
 * check on the column. The media type is what the service sniffed a
 * picture's bytes to be, or the type a file travelled as, which the bytes
 * are served under.
 */
export const attachment = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The owner's workspace, which a read is scoped to and which the row goes with. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The account it was kept for, such as an inbox item's; null for an owner that names none, and once the account is gone. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** The task it belongs to, which moves it to the task's workspace; null where it belongs to none. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** The chat message whose image block names it; null for every other owner's. */
    chatMessageId: uuid("chat_message_id").references(() => chatMessage.id, {
      onDelete: "cascade",
    }),
    /** The inbox item it belongs to; null for every other owner's. */
    inboxItemId: uuid("inbox_item_id").references(() => inboxItem.id, { onDelete: "cascade" }),
    /** The message on the inbox item's thread that carried it; null but for an inbox message's file. */
    inboxMessageId: uuid("inbox_message_id").references(() => inboxMessage.id, {
      onDelete: "cascade",
    }),
    /** How its inbox item holds it: an image block's picture, the answer's file, or a message's; null for every other owner's. */
    kind: text("kind").$type<InboxAttachmentKind>(),
    /** A file's own name, never a path, such as `trace.txt`; null for a picture, whose words are its block's alt. */
    name: text("name"),
    /** A file's place among the files it travelled with, from zero, in the order they were attached; null for a picture. */
    position: integer("position"),
    /** The media type the bytes were sniffed to be, or travelled as: what they are served under. */
    contentType: text("content_type").$type<CodingAgentAttachmentType>().notNull(),
    /** How many bytes it is, read off the row without the bytes. */
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // A message's pictures are read and deleted by the message.
    index("attachment_chat_message")
      .on(table.chatMessageId)
      .where(sql`${table.chatMessageId} is not null`),
    // An item's files are read and deleted by the item, and a message's by the message.
    index("attachment_inbox_item")
      .on(table.inboxItemId)
      .where(sql`${table.inboxItemId} is not null`),
    index("attachment_inbox_message")
      .on(table.inboxMessageId)
      .where(sql`${table.inboxMessageId} is not null`),
    // Exactly one owner stands on a row; each new kind of owner adds its column here. An inbox message's file names its item beside its message.
    check(
      "attachment_one_owner",
      sql`num_nonnulls(${table.chatMessageId}, ${table.inboxItemId}) = 1 and (${table.inboxMessageId} is null or ${table.inboxItemId} is not null)`,
    ),
    // Each owner holds its bytes to its own bound, as the table it kept before did.
    check(
      "attachment_bytes_bound",
      sql`${table.chatMessageId} is null or octet_length(${table.bytes}) <= ${bound(CHAT_BOUNDS.MAX_IMAGE_BYTES)}`,
    ),
    // An inbox item's file is of a kind, held to its kind's bound, and only an answer's or a message's file has a name and a place, and only a message's names a message; no other owner's has a kind.
    check(
      "attachment_inbox_kind",
      sql`(${table.inboxItemId} is null and ${table.kind} is null) or (${table.inboxItemId} is not null and ((${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.IMAGE)} and octet_length(${table.bytes}) <= ${bound(INBOX_BOUNDS.MAX_IMAGE_BYTES)} and ${table.name} is null and ${table.position} is null and ${table.inboxMessageId} is null) or (${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.ANSWER)} and octet_length(${table.bytes}) <= ${bound(CODING_AGENT_BOUNDS.MAX_PDF_BYTES)} and ${table.name} is not null and ${table.position} is not null and ${table.inboxMessageId} is null) or (${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.MESSAGE)} and octet_length(${table.bytes}) <= ${bound(CODING_AGENT_BOUNDS.MAX_PDF_BYTES)} and ${table.name} is not null and ${table.position} is not null and ${table.inboxMessageId} is not null)))`,
    ),
  ],
);
