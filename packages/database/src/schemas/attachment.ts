import { CHAT_BOUNDS } from "@luke/features/chat-wire";
import type { CodingAgentAttachmentType } from "@luke/features/coding-agent-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";
import { chatMessage } from "./chat.js";

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
 * `conversation_attachment`), each expanded, migrated, and contracted as the
 * `db-migrations` skill says, so no deployment's runs read a table the next
 * build dropped. A chat message's pictures are the first: written here
 * beside `chat_attachment` under the same id, which is still read.
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
    /** The chat message whose image block names it; null for every other owner's. */
    chatMessageId: uuid("chat_message_id").references(() => chatMessage.id, {
      onDelete: "cascade",
    }),
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
    // Exactly one owner stands on a row; each new kind of owner adds its column here.
    check("attachment_one_owner", sql`num_nonnulls(${table.chatMessageId}) = 1`),
    // Each owner holds its bytes to its own bound, as the table it kept before did.
    check(
      "attachment_bytes_bound",
      sql`${table.chatMessageId} is null or octet_length(${table.bytes}) <= ${sql.raw(String(CHAT_BOUNDS.MAX_IMAGE_BYTES))}`,
    ),
  ],
);
