import type { InboxAnswers, InboxMessageAuthor, InboxReadAsk } from "@repo/features/inbox-wire";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { inboxItem } from "./inbox.js";

export const inboxMessage = pgTable(
  "inbox_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    author: text("author").$type<InboxMessageAuthor>().notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    ask: jsonb("ask").$type<InboxReadAsk>(),
    answers: jsonb("answers").$type<InboxAnswers>(),
    addresseeId: text("addressee_id").references(() => user.id, { onDelete: "set null" }),
    clientKey: text("client_key"),
    slackDm: jsonb("slack_dm").$type<{
      readonly channel: string;
      readonly ts: string;
      readonly to?: string;
      readonly thread?: string;
      readonly settled?: boolean;
    }>(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("inbox_message_item_created").on(table.itemId, table.createdAt),
    uniqueIndex("inbox_message_client_key")
      .on(table.itemId, table.clientKey)
      .where(sql`${table.clientKey} is not null`),
  ],
);
