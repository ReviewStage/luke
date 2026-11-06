import type { TaskSectionIcon } from "@repo/features/task-section-wire";
import { index, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";
import { task } from "./task.js";

export const taskSection = pgTable(
  "task_section",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    icon: jsonb("icon").$type<TaskSectionIcon>(),
    position: text("position"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("task_section_user").on(table.userId),
    index("task_section_organization").on(table.organizationId),
  ],
);

export const taskSectionEntry = pgTable(
  "task_section_entry",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => taskSection.id, { onDelete: "cascade" }),
    position: text("position"),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    index("task_section_entry_task").on(table.taskId),
    index("task_section_entry_section").on(table.sectionId),
  ],
);

export const agentSectionEntry = pgTable(
  "agent_section_entry",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => taskSection.id, { onDelete: "cascade" }),
    position: text("position"),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.agentId] }),
    index("agent_section_entry_agent").on(table.agentId),
    index("agent_section_entry_section").on(table.sectionId),
  ],
);
