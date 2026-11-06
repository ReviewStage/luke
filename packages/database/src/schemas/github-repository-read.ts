import { boolean, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const githubRepositoryRead = pgTable(
  "github_repository_read",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repository: text("repository").notNull(),
    readable: boolean("readable").notNull(),
    checkedAt: timestamptz("checked_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repository] })],
);
