import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";

/**
 * linear-schema.ts -- one account's Linear connection, as Luke holds it.
 *
 * Vercel Connect keeps the Linear grant and refreshes it; this row is Luke's
 * own word on whether its agents may use that grant, because Connect has no
 * way to ask whether a sign-in finished and its SDK caches tokens in process.
 * A row standing `connected` is what lets an agent read a token
 * (`hosted/linear-connection.ts`); no row is a disconnected account, so a
 * Disconnect deletes the row before anything is asked of Connect, and no
 * cache anywhere outlives it. `state` is the one-time value a browser sign-in
 * carries back to the callback; it stands only while a sign-in is under way,
 * and a connected row keeps its status while the account signs in again.
 */
export const linearConnection = pgTable(
  "linear_connection",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `linear-store.ts`'s `LINEAR_ROW_STATUS`: pending, connected, or expired. */
    status: text("status").notNull(),
    /** The sign-in under way's own value, which only its callback carries back; null when none is. */
    state: text("state"),
    /** When the sign-in under way began; null when none is. */
    stateIssuedAt: instant("state_issued_at"),
    /** When a sign-in last completed; null until one has. */
    connectedAt: instant("connected_at"),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("linear_connection_state_idx").on(table.state)],
);
