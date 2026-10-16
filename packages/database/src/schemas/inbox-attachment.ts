import type { InboxImageType } from "@luke/features/inbox-wire";
import { INBOX_BOUNDS } from "@luke/features/inbox-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { inboxItem } from "./inbox.js";
import { task } from "./plan.js";

/**
 * inbox-attachment.ts -- one picture of an inbox item's: the bytes of an image block, kept beside the item it belongs to.
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
 * is what the bytes are served under. The account and the plan stand on
 * the row beside the item, as they do on the item, so an attachment goes
 * with any of the three, and a read names the account beside the item.
 * A row no block names any longer, once the agent posted its item again
 * without the picture, is deleted with that post (`inbox-store.ts`).
 */
export const inboxAttachment = pgTable(
  "inbox_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The item's plan; null for an item of an agent with no plan. */
    taskId: uuid("plan_id").references(() => task.id, { onDelete: "cascade" }),
    /** The item's workspace. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    /** The media type the bytes were sniffed to be, which they are served under. */
    contentType: text("content_type").$type<InboxImageType>().notNull(),
    /** How many bytes the picture is, read off the row without the bytes. */
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // An item's attachments are read and deleted by the item.
    index("inbox_attachment_item").on(table.itemId),
    check(
      "inbox_attachment_bytes_bound",
      sql`octet_length(${table.bytes}) <= ${INBOX_BOUNDS.MAX_IMAGE_BYTES}`,
    ),
  ],
);
