import { pgTable, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";

export const agentRunnerLeaseTable = pgTable("agent_runner_lease", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agentTable.id, { onDelete: "cascade" }),
  holder: uuid("holder").notNull(),
  heldUntil: timestamptz("held_until").notNull(),
});
