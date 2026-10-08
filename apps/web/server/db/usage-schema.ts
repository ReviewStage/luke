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
    /** Hosted operations spent: a Live session opened and a brain turn count alike. */
    calls: integer("calls").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

/**
 * One closed GPT Live session's billed seconds, keyed by the session id OpenAI
 * minted, so the voice service's report is taken once however many times it
 * is sent: the row is the idempotency ledger, and a repeated report adds
 * nothing. Nothing of the conversation is here, only the id, the account, the
 * seconds, and when the report landed.
 */
export const voiceSessionUsage = pgTable("voice_session_usage", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  seconds: doublePrecision("seconds").notNull(),
  recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
});
