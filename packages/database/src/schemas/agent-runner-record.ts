import { bigint, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

export const agentRunnerRecord = pgTable(
  "agent_runner_record",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    sandboxName: text("sandbox_name").notNull(),
    firstSequence: bigint("first_sequence", { mode: "number" }).notNull(),
    fingerprint: text("fingerprint"),
    sandboxSessionId: text("sandbox_session_id"),
    commandId: text("command_id"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionId] }),
    index("agent_runner_record_agent").on(table.agentId),
  ],
);
