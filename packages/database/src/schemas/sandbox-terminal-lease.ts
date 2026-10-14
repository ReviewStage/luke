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
 * sweep stops one whose lease has lapsed when no turn of the agent runs,
 * then removes the row. The row names a conversation and an instant alone,
 * never a byte of what was typed, and goes with its conversation.
 */
export const sandboxTerminalLease = pgTable(
  "sandbox_terminal_lease",
  {
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The instant the sandbox stops being held; moved on as the developer types, never back. */
    heldUntil: timestamptz("held_until").notNull(),
  },
  (table) => [index("sandbox_terminal_lease_held_until").on(table.heldUntil)],
);
