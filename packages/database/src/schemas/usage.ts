import { doublePrecision, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

/**
 * How much hosted use one signed-in user made on one UTC day. The hosted
 * endpoints run on Luke's own OpenAI key, so this row is the record the admin
 * pages read: the counter is incremented atomically before the upstream call,
 * and nothing is refused on it. One row per user per day; a day with no use
 * has no row.
 */
export const hostedUsage = pgTable(
  "hosted_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The UTC day the counter covers, as YYYY-MM-DD. */
    day: text("day").notNull(),
    /** Hosted operations spent: a Live session opened, a brain turn, and a dictated clip count alike. */
    calls: integer("calls").default(0).notNull(),
    /** Seconds of dictated audio transcribed on Luke's key. */
    dictationSeconds: doublePrecision("dictation_seconds").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);
