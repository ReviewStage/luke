import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const writeReceipt = pgTable(
  "write_receipt",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    writtenAt: timestamptz("written_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);
