import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { inboxItem } from "./inbox.js";

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
    readThrough: timestamptz("read_through"),
    markedUnread: boolean("marked_unread").notNull().default(false),
    remindAt: timestamptz("remind_at"),
    remindThrough: timestamptz("remind_through"),
  },
  (table) => [uniqueIndex("inbox_item_read_item_user").on(table.itemId, table.userId)],
);
