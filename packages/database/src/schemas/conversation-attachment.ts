import { CONVERSATION_PICTURE_BOUNDS } from "@luke/features/conversation-picture-wire";
import type { InboxImageType } from "@luke/features/inbox-wire";
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { conversations } from "./storage.js";

/**
 * conversation-attachment.ts -- one picture a conversation's tools answered: the bytes, kept beside the transcript that names them.
 *
 * A tool may answer the model with a picture, as an integration's MCP tool
 * answers an image block. The relay keeps the picture here and writes the
 * row's id into the stored output in the bytes' place
 * (`brain-host/relay-pictures.ts`), so the transcript's reads, its journal
 * amends, and its long polls carry an id rather than megabytes. The bytes
 * stand in the row itself, as an inbox item's pictures do
 * (`inbox-attachment.ts`): this deployment keeps no blob store, and the
 * bound is a check on the column (`CONVERSATION_PICTURE_BOUNDS.MAX_BYTES`).
 * A picture is keyed by the SHA-256 of its bytes within its conversation,
 * so the same picture answered twice, by an integration's call and the
 * nested call under it, or a screenshot taken again unchanged, is one row.
 * The media type is what the bytes were sniffed to be, and the size in
 * pixels what their header states, so a reader can hold the picture's place
 * before its bytes arrive. A row goes with its conversation, which goes
 * with its parent and its account.
 */
export const conversationAttachment = pgTable(
  "conversation_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The hex SHA-256 of the bytes, which the conversation keeps one row of. */
    sha256: text("sha256").notNull(),
    /** The media type the bytes were sniffed to be, which they are served under. */
    contentType: text("content_type").$type<InboxImageType>().notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** How many bytes the picture is, read off the row without the bytes. */
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // A conversation's pictures are found by their hash and counted by the conversation.
    uniqueIndex("conversation_attachment_conversation_sha256").on(
      table.conversationId,
      table.sha256,
    ),
    check(
      "conversation_attachment_bytes_bound",
      sql`octet_length(${table.bytes}) <= ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES}`,
    ),
  ],
);
