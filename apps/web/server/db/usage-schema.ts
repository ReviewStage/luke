import { bigint, doublePrecision, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * What one signed-in user spent of the hosted allowance on one UTC day. The
 * hosted endpoints run on Luke's own OpenAI key, so this row is the durable
 * brake that keeps one account from spending everyone's: the counter is
 * incremented atomically before the upstream call and checked against the
 * day's ceiling. One row per user per day; a day with no use has no row.
 */
export const hostedUsage = pgTable(
  "hosted_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The UTC day the counter covers, as YYYY-MM-DD. */
    day: text("day").notNull(),
    /** Hosted operations spent: a Realtime mint, a Live session opened, and a brain turn count alike. */
    calls: integer("calls").default(0).notNull(),
    /**
     * GPT Live seconds OpenAI billed for the day's closed sessions, as the
     * voice service reported them. Recorded beside the count rather than in
     * its place: a session still spends one call when it opens, and this is
     * what the meter will move to once sessions, not opens, are what is bounded.
     */
    voiceSeconds: doublePrecision("voice_seconds").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

/**
 * What the unauthenticated introduction mint spent on one UTC day. The
 * endpoint answers before any account exists, so the caller column is not a
 * user: it is the global sentinel row every request shares, the ceiling that
 * keeps a keyless endpoint from becoming a free relay. Nothing about a
 * request is kept.
 */
export const introductionUsage = pgTable(
  "introduction_usage",
  {
    caller: text("caller").notNull(),
    /** The UTC day the counter covers, as YYYY-MM-DD. */
    day: text("day").notNull(),
    mints: integer("mints").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.caller, table.day] })],
);

/**
 * One GPT Live session, keyed by the session id OpenAI minted: the account it
 * was created for, written at creation so a later function connection can
 * prove the account attaching to the session is the one that opened it, and
 * once the session closes the seconds OpenAI billed. A row with no seconds
 * is a session still standing. The row is the idempotency ledger for the
 * report too: the seconds land once, whichever connection sees
 * `session.closed`, and the day's `voice_seconds` moves only when they do.
 * Nothing of the conversation is here.
 */
export const voiceSessionUsage = pgTable("voice_session_usage", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  seconds: doublePrecision("seconds"),
  recordedAt: bigint("recorded_at", { mode: "number" }),
});
