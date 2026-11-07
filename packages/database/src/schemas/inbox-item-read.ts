import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { inboxItem } from "./inbox.js";

/**
 * inbox-item-read.ts -- one member's read marker on one inbox item: how far they have read it, whether they marked it unread, and when, and over which change, it reminds them of it.
 *
 * An item is unread for a member while it changed after the last change
 * they read through, or while they marked it unread and have not read it
 * since. Every member of the item's workspace keeps a marker of their own,
 * so one member reading an item, answering it, or marking it unread never
 * moves another's. A member with no marker reads the item by its own
 * `read_through` (`inbox.ts`): read through the instant unread was first
 * kept on an item that stood before it, and unread on one posted since. The
 * marker goes with its item and with its member's account.
 */
export const inboxItemRead = pgTable(
  "inbox_item_read",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * The item's last change the member has read through, its `updated_at`
     * as it stood when they opened it, answered it, or wrote on its thread;
     * null where they marked it unread before ever reading it.
     */
    readThrough: timestamptz("read_through"),
    /** Whether the member marked the item unread and has not read it since; any change leaves it standing. */
    markedUnread: boolean("marked_unread").notNull().default(false),
    /**
     * When the reminder the member set on the item comes due: it stays out
     * of their Inbox while this is still ahead and the item has not changed
     * since `remind_through`. Setting a reminder leaves whether it is read
     * alone, and reading it leaves the reminder alone. Null where the member
     * set none or canceled it. Note that `snoozed_until`, its name before, stands beside it
     * until a later migration drops it, kept equal by a trigger
     * (`20261105235359_inbox_item_read_remind_expand`), because the release
     * before this one still writes it.
     */
    remindAt: timestamptz("remind_at"),
    /**
     * The item's last change as it stood when the member set the reminder,
     * its `updated_at` then: a later change ends the reminder early. Null
     * where `remind_at` is. Note that `snoozed_through` stands beside it on
     * the same terms as `snoozed_until` beside `remind_at`.
     */
    remindThrough: timestamptz("remind_through"),
  },
  (table) => [
    // One marker per member per item, which every read of an item's unread state looks up.
    uniqueIndex("inbox_item_read_item_user").on(table.itemId, table.userId),
  ],
);
