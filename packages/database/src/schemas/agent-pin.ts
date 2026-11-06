import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

export const agentPin = pgTable(
  "agent_pin",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    position: text("position"),
    pinnedAt: timestamptz("pinned_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.agentId] }),
    index("agent_pin_agent").on(table.agentId),
  ],
);
