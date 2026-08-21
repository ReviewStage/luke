import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * One row per account granted access to the operations dashboard. Admin status
 * is a fact in the database, not a constant in the build: a row here is the
 * whole grant, so who may see the dashboard is managed by inserting and
 * deleting rows rather than by editing and redeploying code. The row cascades
 * away with the account it names, the same way the sign-in and usage rows do.
 */
export const adminUser = pgTable("admin_user", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
});
