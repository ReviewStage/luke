import type { AgentBrowserTabOpener } from "@repo/features/agent-browser-tab-wire";
import type { BrowserCursorKind } from "@repo/features/browser-agent-actions";
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { conversations } from "./storage.js";
import { task } from "./task.js";

export const agentBrowserTab = pgTable(
  "agent_browser_tab",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    targetId: text("target_id").notNull(),
    address: text("address").notNull(),
    title: text("title").notNull().default(""),
    openedBy: text("opened_by").$type<AgentBrowserTabOpener>().notNull(),
    openedByUserId: text("opened_by_user_id").references(() => user.id, { onDelete: "set null" }),
    driverUserId: text("driver_user_id").references(() => user.id, { onDelete: "set null" }),
    heldUntil: timestamptz("held_until"),
    createdAt: createdAt(),
    lastActedAt: timestamptz("last_acted_at").notNull().defaultNow(),
    cursorX: doublePrecision("cursor_x"),
    cursorY: doublePrecision("cursor_y"),
    cursorKind: text("cursor_kind").$type<BrowserCursorKind>(),
    cursorViewportW: integer("cursor_viewport_w"),
    cursorViewportH: integer("cursor_viewport_h"),
    cursorAt: timestamptz("cursor_at"),
  },
  (table) => [
    uniqueIndex("agent_browser_tab_conversation_target").on(table.conversationId, table.targetId),
    index("agent_browser_tab_task_created").on(table.taskId, table.createdAt),
  ],
);
