import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * The latest roster one observation pass reported for a user: one row,
 * replaced whole on every pass, so the next pass can tell a session that
 * changed from one that merely still stands. The body carries titles,
 * branches, and error lines, so it is sealed; the instant it was observed
 * stands clear, because it is what decides whether the snapshot is current.
 */
export const rosterSnapshot = pgTable("roster_snapshot", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The roster as the pass reported it. Sealed. */
  sealedBody: text("sealed_body").notNull(),
  observedAt: bigint("observed_at", { mode: "number" }).notNull(),
});
