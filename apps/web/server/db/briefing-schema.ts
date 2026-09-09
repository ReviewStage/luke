import { bigint, index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * A briefing the brain decided to give, waiting to be said on whichever
 * device is active. Its life is the state column: offered, then claimed by
 * one device in one atomic update, then spoken by that device, pushed to a
 * phone when none was active, or expired unspoken. The words are sealed; the
 * conversation and run it came from, the instants, and the state stand clear
 * because they are what a feed reads and a transition checks. The claiming
 * device is a plain column for now: the devices table lands beside this one
 * in its own change, and this column takes its reference then.
 */
export const briefing = pgTable(
  "briefing",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The briefing's id as the brain minted it; one user's ids never stand in another's way. */
    id: text("id").notNull(),
    sessionKey: text("session_key").notNull(),
    runId: text("run_id"),
    /** The briefing's words, as the brain chose to say them. Sealed. */
    sealedWords: text("sealed_words").notNull(),
    decidedAt: bigint("decided_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    claimedByDeviceId: text("claimed_by_device_id"),
    claimedAt: bigint("claimed_at", { mode: "number" }),
    settledAt: bigint("settled_at", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("briefing_by_user_state").on(table.userId, table.state, table.decidedAt),
  ],
);
