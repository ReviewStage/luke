import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
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
    /** Hosted operations spent: a Realtime mint and a brain turn count alike. */
    calls: integer("calls").default(0).notNull(),
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
