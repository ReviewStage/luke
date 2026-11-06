import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

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
