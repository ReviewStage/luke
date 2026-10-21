import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { codingAgent } from "./coding-agent.js";

/**
 * coding-agent-wakeup.ts -- the wakeups a native agent's released wait left for Luke to deliver.
 *
 * A Claude Code agent waiting on nothing but one-shot wakeups is released:
 * its runner ends the launch so the sandbox stops, and names each wakeup,
 * the instant it comes due and the prompt the CLI would have run then, in
 * its last event (`@luke/agent-runner/protocol`'s `RUNNER_RELEASE`). One row
 * per wakeup, which the scheduled sweep delivers to the agent as a message
 * once due and deletes once delivered (`native-wakeup-sweep.ts`). A later
 * release replaces the agent's rows, and a Stop deletes them, as a stopped
 * CLI's own wakeups end with it. The rows go with their agent.
 */
export const codingAgentWakeup = pgTable(
  "coding_agent_wakeup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    /** The prompt the CLI would have run as the wakeup fired, which is delivered as the message. */
    prompt: text("prompt").notNull(),
    /** When the wakeup is next delivered: as it comes due, then again past a delivery that failed. */
    dueAt: timestamptz("due_at").notNull(),
    /** How many deliveries were claimed, so one that keeps failing is given up. */
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    // The sweep reads the wakeups due, the longest due first.
    index("coding_agent_wakeup_due").on(table.dueAt),
    // A release replaces, and a Stop deletes, one agent's wakeups.
    index("coding_agent_wakeup_agent").on(table.agentId),
  ],
);
