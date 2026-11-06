import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { conversations } from "./storage.js";

/**
 * sandbox-terminal-lease.ts -- how long a coding agent's sandbox is held for the terminals a developer is typing in.
 *
 * One row per coding agent's conversation, written by the terminal relay as
 * the developer types: each keystroke moves `held_until` to a few minutes on,
 * so a sandbox stays up while someone uses its terminals and no longer. The
 * agent's turn-end stop leaves a held sandbox running, for Vercel's own
 * timeout to stop once the developer stops typing. The row names a conversation and instants alone, never a byte of what was
 * typed, and goes with its conversation.
 */
export const sandboxTerminalLease = pgTable("sandbox_terminal_lease", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  /** The instant the sandbox stops being held; moved on as the developer types, never back. */
  heldUntil: timestamptz("held_until").notNull(),
  /** When the terminal relay last set a fresh GitHub token at the sandbox's firewall; null until it has. */
  credentialAt: timestamptz("credential_at"),
  /** The sandbox session that token was set on: a resumed sandbox is a new session whose firewall holds none. */
  credentialSession: text("credential_session"),
});
