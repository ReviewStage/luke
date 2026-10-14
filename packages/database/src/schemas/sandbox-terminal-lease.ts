import { index, pgTable, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { conversations } from "./storage.js";

/**
 * sandbox-terminal-lease.ts -- how long a coding agent's sandbox is held for the terminals a developer is typing in.
 *
 * One row per coding agent's conversation, written by the terminal relay as
 * the developer types: each keystroke moves `held_until` to a few minutes on,
 * so a sandbox stays up while someone uses its terminals and no longer. The
 * agent's turn-end stop leaves a held sandbox running, and the scheduled
 * sweep claims a lease that has lapsed while no turn of the agent runs,
 * stops its sandbox, and is done with it; a stop Vercel did not confirm puts
 * the lease back stamped `tried_at`, behind the leases not yet tried. The
 * row names a conversation and instants alone, never a byte of what was
 * typed, and goes with its conversation.
 */
export const sandboxTerminalLease = pgTable(
  "sandbox_terminal_lease",
  {
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The instant the sandbox stops being held; moved on as the developer types, never back. */
    heldUntil: timestamptz("held_until").notNull(),
    /** When a sweep last tried to stop the sandbox and Vercel did not confirm it; null until one has, and again once the developer types. */
    triedAt: timestamptz("tried_at"),
  },
  (table) => [index("sandbox_terminal_lease_next").on(table.triedAt, table.heldUntil)],
);
