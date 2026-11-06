import { bigint, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * agent-runner-record.ts -- where a cloud agent's runner stands in the sandbox of one of its sessions: the launch a late END is told by, and the command a later call writes to.
 *
 * A launch writes the row under the agent's runner lease
 * (`agent-runner-lease.ts`), and every call that reads where the runner
 * stands reads it back (`../models/agent-runner-record.ts`,
 * `@repo/service`'s `agents/machine/vercel-machine.ts`), so the sandbox's
 * tags carry only what finds it: our session and its agent. One row per
 * account and session, which names the sandbox it was written for, so a
 * session's older sandbox, kept beside the one that replaced it, reads no
 * runner of the newer's. The row is deleted once it tells of no launch, and
 * goes with its agent and its account alike. It holds ids and an event
 * number alone, and a digest of what the launch was started with.
 */
export const agentRunnerRecord = pgTable(
  "agent_runner_record",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Our runtime session, which the conversation records and the sandbox's tag names. */
    sessionId: text("session_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The sandbox the record was written for, by its name. */
    sandboxName: text("sandbox_name").notNull(),
    /** The launch's first event number, which an END older than it is told stale by. */
    firstSequence: bigint("first_sequence", { mode: "number" }).notNull(),
    /** A digest of what the launch was started with that a warm runner cannot take up later; null where the launch's record names none. */
    fingerprint: text("fingerprint"),
    /** The sandbox session the runner was started in; null while none runs. */
    sandboxSessionId: text("sandbox_session_id"),
    /** The runner's command in that session; null while none runs. */
    commandId: text("command_id"),
  },
  (table) => [
    // An account's own row for a session; its account leads, so the account's deletion finds its rows by it.
    primaryKey({ columns: [table.userId, table.sessionId] }),
    // An agent's delete cascades to its records, found by the agent alone.
    index("agent_runner_record_agent").on(table.agentId),
  ],
);
