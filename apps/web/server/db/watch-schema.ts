import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * The account's memory of where its cloud sessions stood when the scheduled
 * watch last looked: the notice tracker's snapshot, which is identifiers,
 * statuses, and timestamps and never a title, activity, or error. One row
 * per account, because the memory is the account's rather than any one
 * phone's — a desktop reading it later needs no migration — and rewritten
 * whole on every pass. The row goes with the account, and with an account
 * that no longer has a phone or a key to watch for.
 */
export const watchMemory = pgTable("watch_memory", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  memory: jsonb("memory").notNull(),
  /** When the last pass completed; the gap since it decides whether an edge is news or history. */
  passedAt: timestamp("passed_at").notNull(),
});
