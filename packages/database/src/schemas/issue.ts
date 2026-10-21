import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@luke/features/task-wire";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * issue.ts -- a workspace's own issues, which Luke no longer keeps.
 *
 * @deprecated Luke has one noun, the task, which carries its own status,
 * priority, and key (`task.ts`); an issue now only means a Linear or GitHub
 * issue a task links (`task-issue.ts`). Nothing reads or writes this table.
 * It stands until no running build reads it, then a later migration drops
 * it, with no data carried over.
 *
 * An issue was its workspace's (`organization_id`), and went with it.
 * `number` counted a workspace's issues from one in the order they were
 * filed. Status and priority spelled the words a task's do now
 * (`@luke/features/task-wire`). `creator_id` was the member who filed it,
 * null once their account is gone. `archived_at` stamped an issue archived.
 */
export const issue = pgTable(
  "issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<TaskStatus>().notNull().default(TASK_STATUS.BACKLOG),
    priority: text("priority").$type<TaskPriority>().notNull().default(TASK_PRIORITY.NONE),
    creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The identifier names one issue of its workspace, and a filing takes the next number.
    uniqueIndex("issue_org_number").on(table.organizationId, table.number),
    // The list reads a workspace's issues newest changed first.
    index("issue_org_updated").on(table.organizationId, table.updatedAt),
  ],
);
