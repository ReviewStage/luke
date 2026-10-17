import type { InboxMessageAuthor } from "@luke/features/inbox-wire";
import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { inboxItem } from "./inbox.js";

/**
 * inbox-message.ts -- one message on an inbox item's thread: words a member of the item's workspace, or the item's own agent, added at any point, open or settled.
 *
 * An item holds one answer (`inbox.ts`) and, beside it, a thread a member
 * or the agent adds to whenever there is something to say, so a message is
 * a row of its own rather than a column of the item's. Who wrote it is its
 * author: a member, kept by their account, or the agent, which is the
 * item's own and so needs no column; a message stays when its member's
 * account is gone, naming nobody. The words are Markdown kept as they were
 * sent, as an answer's note is, so a mention in them stands as its link.
 * The files a message carried are rows of the item's attachments of the
 * message kind, naming the message (`inbox-attachment.ts`). The key a
 * member's client wrote it under is unique on the item, so a message sent
 * again after a lost reply is written once. A message goes with its item,
 * and with it the account, the task, and the agent the item goes with; a
 * post under the item's key changes what it asks and leaves the thread.
 */
export const inboxMessage = pgTable(
  "inbox_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inboxItem.id, { onDelete: "cascade" }),
    /** Who wrote it: a member of the item's workspace, or the item's agent. */
    author: text("author").$type<InboxMessageAuthor>().notNull(),
    /** The member who wrote it; null for the agent's, and once the member's account is gone. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** The words in Markdown, as they were sent; empty where the files carry the message alone. */
    text: text("text").notNull(),
    /** The key a member's client wrote it under; null for the agent's. */
    clientKey: text("client_key"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // An item's thread is read in the order it was written.
    index("inbox_message_item_created").on(table.itemId, table.createdAt),
    // A message sent again under its key is the message already written.
    uniqueIndex("inbox_message_client_key")
      .on(table.itemId, table.clientKey)
      .where(sql`${table.clientKey} is not null`),
  ],
);
