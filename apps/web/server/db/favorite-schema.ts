import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * One admin's own star on one account, purely a marker for the admin who set
 * it. It lives in the database rather than the browser because it is the
 * admin's reading of an account, not this machine's state: it follows their
 * sign-in across browsers and never bleeds into another admin's roster on a
 * shared one. Each row belongs to the (admin, account) pair and leaves with
 * either side.
 */
export const adminFavorite = pgTable(
  "admin_favorite",
  {
    adminId: text("admin_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.adminId, table.userId] })],
);
