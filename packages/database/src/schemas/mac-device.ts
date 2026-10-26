import type { MacSignedIn } from "@luke/features/mac-agent-wire";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * mac-device.ts -- one of an account's Macs that can run its local agents, and when it last said it was there.
 *
 * The desktop mints the id once and keeps it, and registers it under the
 * account it is signed in to; an id another account registered first is
 * never moved onto this one. While the desktop runs local agents it beats
 * the row, so `last_seen_at` is what the service reads as the Mac being
 * there to take a new agent. It registers again on every start, so `home`,
 * `claude_executable`, and `codex_executable` follow the account's home
 * folder and the harnesses the app runs, which move with every update. A
 * local agent is pinned to one of these
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
    /** The Mac's home folder, absolute, as the desktop read it: where a local agent's folder is (`~/.luke/agents/<agent>`). */
    home: text("home").notNull(),
    /** The Claude Code CLI the desktop bundles, by its absolute path, which a local agent's launch names. */
    claudeExecutable: text("claude_executable").notNull(),
    /**
     * The Codex binary the desktop runs local agents' Codex with, by its
     * absolute path, once it checked that build against the pin, bundled or
     * fetched; null for a Mac that has none checked yet, which runs no Codex
     * agent.
     */
    codexExecutable: text("codex_executable"),
    /**
     * Which harnesses the Mac is signed in to by itself, as its register and
     * beats last said, never the credential: a local agent on one launches on
     * the Mac's own login rather than the account's saved credential.
     */
    signedIn: jsonb("signed_in").$type<MacSignedIn>().notNull().default({}),
    createdAt: createdAt(),
    /** When the desktop last beat, or registered, the Mac. */
    lastSeenAt: timestamptz("last_seen_at").notNull(),
  },
  // Start reads the account's Macs that beat lately.
  (table) => [index("mac_device_user_seen").on(table.userId, table.lastSeenAt)],
);
