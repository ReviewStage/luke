import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * mac-device.ts -- one of an account's Macs that can run its local agents, and when it last said it was there.
 *
 * The desktop mints the id once and keeps it, and registers it under the
 * account it is signed in to; an id another account registered first is
 * never moved onto this one. While the desktop runs local agents it beats
 * the row, so `last_seen_at` is what the service reads as the Mac being
 * there to take a new agent. A local agent is pinned to one of these
 * (`coding_agent.device_id`), and every line and request for it names the
 * same Mac (`./mac-agent.ts`). The row belongs to the account and leaves
 * with it.
 */
export const macDevice = pgTable(
  "mac_device",
  {
    /** Minted by the desktop, once per install. */
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The Mac's own name, as the desktop read it from the system, for the agent's label. */
    name: text("name").notNull(),
    createdAt: createdAt(),
    /** When the desktop last beat, or registered, the Mac. */
    lastSeenAt: timestamptz("last_seen_at").notNull(),
  },
  // Start reads the account's Macs that beat lately.
  (table) => [index("mac_device_user_seen").on(table.userId, table.lastSeenAt)],
);
