import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import type { DescriptionAgentEdit } from "@repo/features/description-notes";
import {
  DESCRIPTION_ACTOR,
  TASK_MODE,
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskCreatorActor,
  type TaskMode,
  type TaskPriority,
  type TaskStatus,
} from "@repo/features/task-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { agentTable, type StoredArchive } from "./agent.js";
import { organization, user } from "./auth.js";

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    number: integer("number").notNull(),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => task.id, {
      onDelete: "set null",
    }),
    mode: text("mode").$type<TaskMode>().notNull().default(TASK_MODE.AGENT),
    status: text("status").$type<TaskStatus>().notNull().default(TASK_STATUS.TODO),
    priority: text("priority").$type<TaskPriority>().notNull().default(TASK_PRIORITY.NONE),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    creatorActor: text("creator_actor")
      .$type<TaskCreatorActor>()
      .notNull()
      .default(DESCRIPTION_ACTOR.DEVELOPER),
    creatorAgentId: uuid("creator_agent_id").references((): AnyPgColumn => agentTable.id, {
      onDelete: "set null",
    }),
    madeByStart: boolean("made_by_start").notNull().default(false),
    agentEdits: jsonb("agent_edits")
      .$type<readonly DescriptionAgentEdit[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    document: text("document").notNull(),
    repository: text("repository"),
    githubAccess: text("github_access").$type<GitHubAccess>().notNull().default(GITHUB_ACCESS.APP),
    brief: text("brief"),
    /** @deprecated A pin is its reader's own now, in `plan_pin`, and nothing writes or reads this. */
    pinnedAt: timestamptz("pinned_at"),
    completedAt: timestamptz("completed_at"),
    doneBy: jsonb("done_by").$type<StoredArchive>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    readThrough: timestamptz("read_through"),
  },
  (table) => [
    index("task_user_created").on(table.userId, table.createdAt),
    index("task_organization_created").on(table.organizationId, table.createdAt),
    uniqueIndex("task_organization_number").on(table.organizationId, table.number),
    index("task_organization_assignee").on(table.organizationId, table.assigneeId),
    index("task_parent").on(table.parentTaskId).where(sql`${table.parentTaskId} is not null`),
    check("task_parent_not_self", sql`${table.parentTaskId} <> ${table.id}`),
  ],
);

export const taskNumberCounter = pgTable("task_number_counter", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  lastNumber: integer("last_number").notNull(),
});

export const taskNumberForward = pgTable(
  "task_number_forward",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.number] }),
    index("task_number_forward_task").on(table.taskId),
  ],
);
