import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";

/**
 * agent-pin.ts -- one coding agent with no plan an account pinned in its sidebar, and when.
 *
 * A pin lives on the account rather than on the agent because it is the
 * developer's reading of their own work, as a plan's is (`plan-pin.ts`): an
 * agent an automation started in a shared workspace, pinned by one member,
 * stands pinned for them alone, and follows their sign-in to every Mac.
 * Pinning an agent already pinned keeps the instant it was first pinned;
 * dragging it in the sidebar gives it a position, which a pin with none
 * stands beside by that instant; unpinning deletes the row. Each row
 * leaves with its account or its agent, whichever goes first, and one left
 * behind by a member who has since left the workspace reads as nothing,
 * since every read gates on membership first.
 */
export const agentPin = pgTable(
  "agent_pin",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codingAgentId: uuid("coding_agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    // Where the pin stands in the sidebar's Pinned section once it has been dragged, a fractional index (`@luke/features/pin-order`); null stands it by `pinnedAt`.
    position: text("position"),
    pinnedAt: timestamptz("pinned_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.codingAgentId] }),
    // An agent's delete cascades to its pins, found by the agent alone.
    index("agent_pin_agent").on(table.codingAgentId),
  ],
);
