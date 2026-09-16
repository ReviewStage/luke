import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";

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
 * The opener's high-water mark over an account's transcripts: the instant, as
 * the provider stamps a chat's transcript last changed, up to which every
 * change has been handed to the brain. One row per account, a bare instant
 * with nothing to seal, and what wakes an observed conversation, the snapshot
 * never being diffed. It moves only forward and only over the mark the visit
 * read, so two visits that overlapped cannot put it back.
 */
export const transcriptMark = pgTable("transcript_mark", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The instant the mark stands at, as epoch milliseconds. */
  mark: bigint("mark", { mode: "number" }).notNull(),
  updatedAt: instant("updated_at").notNull(),
});

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
