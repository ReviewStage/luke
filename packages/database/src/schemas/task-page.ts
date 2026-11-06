import type { PageShower } from "@repo/features/page-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { task } from "./task.js";

export const taskPageVersion = pgTable(
  "task_page_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    pageId: uuid("page_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    html: text("html").notNull(),
    shownBy: jsonb("shown_by").$type<PageShower>(),
    at: timestamptz("at").notNull(),
  },
  (table) => [
    unique("task_page_version_page_version").on(table.pageId, table.version),
    index("task_page_version_task").on(table.taskId),
    index("task_page_version_agent").on(table.agentId),
    check(
      "task_page_version_owner",
      sql`${table.taskId} is not null or ${table.agentId} is not null`,
    ),
  ],
);
