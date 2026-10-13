import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * linear-schema.ts -- one account's Linear connection, as Luke held it before integrations.
 *
 * Read by nothing: `integration_connection` (`integration.ts`) holds every
 * provider's row now, Linear's copied into it by the migration that made it.
 * The table stands one more deploy so a build still running against it
 * during that deploy keeps working, and is dropped by the next migration.
 */
export const linearConnection = pgTable(
  "linear_connection",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Pending, connected, or expired, as `integration_connection.status` says them. */
    status: text("status").notNull(),
    /** The sign-in under way's own value, which only its callback carries back; null when none is. */
    state: text("state"),
    /** When the sign-in under way began; null when none is. */
    stateIssuedAt: timestamptz("state_issued_at"),
    /** When a sign-in last completed; null until one has. */
    connectedAt: timestamptz("connected_at"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("linear_connection_state_idx").on(table.state)],
);
