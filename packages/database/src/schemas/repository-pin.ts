import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * One repository an account pinned in the sidebar, by its full name, and when
 * it was first pinned. It lives on the account rather than on a Mac because a
 * pin is the developer's reading of their own work, as a task's pin is, so it
 * follows their sign-in to every Mac. Each row belongs to the account and
 * leaves with it; unpinning deletes the row.
 */
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
