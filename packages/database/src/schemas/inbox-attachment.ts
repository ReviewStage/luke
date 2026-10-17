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
import { inboxItem } from "./inbox.js";
import { task } from "./task.js";

/** A value written into the check as SQL rather than a parameter, which a constraint cannot take. */
const literal = (value: string) => sql.raw(`'${value}'`);
const bound = (bytes: number) => sql.raw(String(bytes));

/**
 * inbox-attachment.ts -- one file of an inbox item's: the bytes of an image block's picture, or of a file the developer's answer carried, kept beside the item it belongs to.
 *
 * An agent posts an image by the path of a file in its sandbox, and the
 * service reads the file and keeps it here, so the item's block names a
 * row of this table rather than anything the agent wrote, and the desktop
 * fetches the row under the account. The bytes stand in the row itself: a
 * picture is at most the image bound (`INBOX_BOUNDS.MAX_IMAGE_BYTES`), a
 * few hundred kilobytes for a screenshot, and this deployment keeps no
 * blob store, so a column is one fewer service to hold the account's
 * data in and one fewer to delete it from; the bound is a check on the
 * column, so no row can hold more than a block may carry. The media type
 * is what the service sniffed the bytes to be, never the file's name, and
 * is what the bytes are served under. The account and the task stand on
 * the row beside the item, as they do on the item, so an attachment goes
 * with any of the three, and a read names the account beside the item.
 * A row no block names any longer, once the agent posted its item again
 * without the picture, is deleted with that post (`inbox-store.ts`).
 *
 * A file the developer attached to their answer is kept here too, as a row
 * of the answer kind: its own name, the type it travelled as, which it is
 * served under, and its place among the answer's files. Each kind keeps its
 * own bound, a picture the image bound and an answer's file the largest a
 * message's file may be (`CODING_AGENT_BOUNDS.MAX_PDF_BYTES`), and only an
 * answer's file has a name and a place. An answer's files go when the
 * answer is taken back, or when the agent posts the item again, which opens
 * it and clears the answer.
 */
export const inboxAttachment = pgTable(
  "inbox_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The item's task; null for an item of an agent with no task. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** The item's workspace. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    /** A picture of an image block's, as every row before answers carried files was, or a file of the answer's. */
    kind: text("kind").$type<InboxAttachmentKind>().notNull().default(INBOX_ATTACHMENT_KIND.IMAGE),
    /** An answer's file's own name, never a path, such as `trace.txt`; null for a picture, whose words are its block's alt. */
    name: text("name"),
    /** An answer's file's place among the answer's files, from zero, in the order the developer attached them; null for a picture. */
    position: integer("position"),
    /** The media type a picture's bytes were sniffed to be, or the type an answer's file travelled as: what the bytes are served under. */
    contentType: text("content_type").$type<CodingAgentAttachmentType>().notNull(),
    /** How many bytes the picture is, read off the row without the bytes. */
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // An item's attachments are read and deleted by the item.
    index("inbox_attachment_item").on(table.itemId),
    // Each kind is held to its own bound, and only an answer's file has a name and a place.
    check(
      "inbox_attachment_kind_bound",
      sql`(${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.IMAGE)} and octet_length(${table.bytes}) <= ${bound(INBOX_BOUNDS.MAX_IMAGE_BYTES)} and ${table.name} is null and ${table.position} is null) or (${table.kind} = ${literal(INBOX_ATTACHMENT_KIND.ANSWER)} and octet_length(${table.bytes}) <= ${bound(CODING_AGENT_BOUNDS.MAX_PDF_BYTES)} and ${table.name} is not null and ${table.position} is not null)`,
    ),
  ],
);
