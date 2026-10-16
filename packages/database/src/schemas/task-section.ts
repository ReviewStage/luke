import type { TaskSectionIcon } from "@luke/features/task-section-wire";
import { index, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { task } from "./plan.js";

/**
 * task-section.ts -- the sections an account made in a workspace's sidebar, and which of its tasks it keeps in each.
 *
 * A section is its maker's own, as a pin is (`plan-pin.ts`): one account's
 * in one workspace, so a section one member makes in a shared workspace
 * stands in their sidebar alone, and follows their sign-in to every Mac. Its
 * id is the maker's choice, so the Mac draws it before the service answers.
 * A section leaves with its account or its workspace; one left behind by a
 * member who has since left the workspace reads as nothing, since every read
 * gates on membership first.
 */
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
    // One emoji or one of Luke's glyphs (`@luke/features/task-section-wire`); null for none.
    icon: jsonb("icon").$type<TaskSectionIcon>(),
    // Where it stands among the account's sections once dragged, a fractional index (`@luke/features/pin-order`); null stands it by `createdAt`.
    position: text("position"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // Every read is one account's sections.
    index("task_section_user").on(table.userId),
    // A workspace's delete cascades to its sections, found by the workspace alone.
    index("task_section_organization").on(table.organizationId),
  ],
);

/**
 * One task an account keeps in one of its sections, at most one section per
 * task for each account, so a task moved to another section moves rather
 * than stands twice. It leaves with its account, its task, or its section,
 * so deleting a section puts its tasks back under Tasks and deletes none.
 */
export const taskSectionEntry = pgTable(
  "task_section_entry",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("plan_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => taskSection.id, { onDelete: "cascade" }),
    // Where it stands among the section's tasks once dragged; null stands it by `addedAt`.
    position: text("position"),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    // A task's delete cascades to its entries, found by the task alone.
    index("task_section_entry_plan").on(table.taskId),
    // A section's delete cascades to its entries, found by the section alone.
    index("task_section_entry_section").on(table.sectionId),
  ],
);
