import { doublePrecision, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const hostedUsage = pgTable(
  "hosted_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    calls: integer("calls").default(0).notNull(),
    dictationSeconds: doublePrecision("dictation_seconds").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);
