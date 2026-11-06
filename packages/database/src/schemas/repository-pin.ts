import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const repositoryPin = pgTable(
  "repository_pin",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repository: text("repository").notNull(),
    pinnedAt: timestamptz("pinned_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repository] })],
);
