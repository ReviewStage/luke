/**
 * claude-session-entry.ts -- an agent's CLI transcript, one row per JSONL entry, which the CLI resumes from on a sandbox that no longer holds its own files.
 *
 * The table of Anthropic's reference Postgres `SessionStore`
 * (`claude-agent-sdk-typescript`'s `examples/session-stores/postgres`), with
 * one column beside the example's: the agent's conversation, so a runner
 * reads and writes its own agent's rows alone, and the rows go with the
 * conversation however it is removed, the seven-day purge of a deleted one
 * and its account's deletion among them. Claude Code's entries are mirrored
 * here by the Agent SDK, and Codex's rollout lines by the runner, both
 * through the service (`../models/claude-session-entries.ts`).
 */

import { bigserial, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers.js";
import { conversations } from "./storage.js";

/**
 * One transcript entry, in the order it was appended (`id`). `subpath` is
 * null for the main transcript and names a subagent's transcript otherwise.
 * `entry` is the line as the CLI wrote it, opaque to us.
 */
export const claudeSessionEntries = pgTable(
  "claude_session_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    projectKey: text("project_key").notNull(),
    sessionId: text("session_id").notNull(),
    subpath: text("subpath"),
    entry: jsonb("entry").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // The example's covering index, led by the conversation every read and its cascade name.
    index("claude_session_entries_key_idx").on(
      table.conversationId,
      table.projectKey,
      table.sessionId,
      table.subpath,
      table.id,
    ),
  ],
);
