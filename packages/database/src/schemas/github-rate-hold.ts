import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz, updatedAt } from "./_helpers.js";

export const githubRateHold = pgTable("github_rate_hold", {
  identity: text("identity").primaryKey(),
  heldUntil: timestamptz("held_until").notNull(),
  strikes: integer("strikes").notNull(),
  updatedAt: updatedAt(),
});
