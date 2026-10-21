import type { AgentBrowserTabOpener } from "@luke/features/agent-browser-tab-wire";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { conversations } from "./storage.js";
import { task } from "./task.js";

/**
 * agent-browser-tab.ts -- one tab open in an agent's browser, kept so a task's members list it on any client and can take it over.
 *
 * An agent runs one browser in its own sandbox, and a row stands for each
 * tab open in it, written as the agent acts on the tab and deleted as it
 * closes. The agent is named by its own conversation, the one its sandbox
 * is kept for (`coding_agent.conversation_id`), and a worker's tabs are its
 * parent's, whose sandbox it works in. So a tab goes with its agent's
 * conversation, however that conversation is removed, the thirty-day purge
 * of a deleted one among them, and with its task.
 *
 * The CDP target id is the browser's own name for the tab, unique within
 * the one browser. The address and title are as the page last stood, cut
 * where the Browser tab cuts them. A member who takes a tab over is its
 * driver until `held_until`, which their window keeps moving on, so a
 * takeover whose window went away lapses on its own; the take is a
 * check-and-set on the driver and the instant, so two members never both
 * drive one tab.
 */
export const agentBrowserTab = pgTable(
  "agent_browser_tab",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The conversation of the coding agent whose browser holds the tab. */
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The task the agent is on; null for an agent on none. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** The browser's CDP target id for the tab, such as `9A3F…`; unique within the agent's browser. */
    targetId: text("target_id").notNull(),
    /** The page's address as it last stood, cut at the Browser tab's bound. */
    address: text("address").notNull(),
    /** The page's title as it last stood, cut at the Browser tab's bound; empty before the page names one. */
    title: text("title").notNull().default(""),
    /** Who opened the tab: the agent, or a member, whom `opened_by_user_id` names. */
    openedBy: text("opened_by").$type<AgentBrowserTabOpener>().notNull(),
    /** The member who opened the tab; null for the agent's own, and once that member's account is gone. */
    openedByUserId: text("opened_by_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The member who took the tab over; null while the agent has it. A takeover past `held_until` has lapsed. */
    driverUserId: text("driver_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The instant the driver's takeover lapses at unless their window renews it; null while no member drives. */
    heldUntil: timestamptz("held_until"),
    createdAt: createdAt(),
    /** When the agent last acted on the tab. */
    lastActedAt: timestamptz("last_acted_at").notNull().defaultNow(),
  },
  (table) => [
    // One row per tab of one browser: an agent's action on a tab it already holds updates that row.
    uniqueIndex("agent_browser_tab_conversation_target").on(table.conversationId, table.targetId),
    // A task's tabs are listed in the order they opened.
    index("agent_browser_tab_task_created").on(table.taskId, table.createdAt),
  ],
);
