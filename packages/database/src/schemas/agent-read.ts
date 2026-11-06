import { boolean, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

export const agentRead = pgTable(
  "agent_read",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    readThrough: timestamptz("read_through"),
    markedUnread: boolean("marked_unread").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.agentId] }),
    index("agent_read_agent").on(table.agentId),
  ],
);
