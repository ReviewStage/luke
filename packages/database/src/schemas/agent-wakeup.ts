import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";

export const agentWakeupTable = pgTable(
  "agent_wakeup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    dueAt: timestamptz("due_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("agent_wakeup_due").on(table.dueAt),
    index("agent_wakeup_agent").on(table.agentId),
  ],
);
