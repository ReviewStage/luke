import { boolean, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * agent-read.ts -- one member's read mark on one agent with no task: the newest activity they looked at, and whether they marked it unread.
 *
 * The agent's counterpart of a task's mark (`task-read.ts`), kept on the
 * account so it follows the member to every Mac and browser. A member with
 * no mark reads the agent through its own `read_through` (`agent.ts`), or
 * its start where that is null. Each row leaves with its account or its
 * agent.
 */
export const agentRead = pgTable(
  "agent_read",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The agent's newest activity the member looked at; null where they marked it unread before ever looking. */
    readThrough: timestamptz("read_through"),
    /** Whether the member marked the agent unread and has not opened it since. */
    markedUnread: boolean("marked_unread").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.agentId] }),
    // An agent's delete cascades to its marks, found by the agent alone.
    index("agent_read_agent").on(table.agentId),
  ],
);
