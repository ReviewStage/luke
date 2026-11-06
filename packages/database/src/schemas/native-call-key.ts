import { pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { conversations } from "./storage.js";

export const nativeCallKey = pgTable(
  "native_call_key",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    digest: text("digest").notNull(),
    key: text("key").notNull(),
    mintedAt: timestamptz("minted_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.conversationId, table.digest] })],
);
