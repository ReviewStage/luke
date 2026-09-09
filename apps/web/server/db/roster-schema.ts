import { bigint, index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
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

/**
 * What changed between two consecutive snapshots of one user's roster: the
 * sessions that appeared or vanished, the status transitions, the error
 * lines and workspace lifecycle words that moved, and the workspaces that
 * came or went. A row is written only when something changed, and it waits
 * here for the brain host to consume; the snapshot itself is the truth the
 * diff was read from, so a diff dropped past the pending bound loses nothing
 * a later read cannot recover. The payload names titles and error lines, so
 * it is sealed.
 */
export const rosterDiff = pgTable(
  "roster_diff",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** The instant of the snapshot the diff led to. */
    observedAt: bigint("observed_at", { mode: "number" }).notNull(),
    /** The instant of the snapshot the diff was taken against. */
    previousObservedAt: bigint("previous_observed_at", { mode: "number" }).notNull(),
    /** The diff whole. Sealed. */
    sealedPayload: text("sealed_payload").notNull(),
    consumedAt: bigint("consumed_at", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("roster_diff_by_user_pending").on(table.userId, table.consumedAt, table.observedAt),
  ],
);

/**
 * How the last scheduled pass over one user's providers went: when it was
 * attempted, when it last read the whole roster, and the failure that kept
 * the previous snapshot standing when it did not. The scheduler orders
 * accounts by the attempt, oldest first, so a user whose provider keeps
 * refusing cannot starve the rest. Fixed vocabulary and instants only;
 * nothing here is sealed because nothing here is the user's.
 */
export const observationPass = pgTable("observation_pass", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  attemptedAt: bigint("attempted_at", { mode: "number" }).notNull(),
  observedAt: bigint("observed_at", { mode: "number" }),
  failure: text("failure"),
});
