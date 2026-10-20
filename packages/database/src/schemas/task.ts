import type { BoardElement, DrawingElement } from "@luke/features/board-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import type { PlanAgentEdit } from "@luke/features/plan-template";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@luke/features/task-wire";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { issue } from "./issue.js";
import { conversations } from "./storage.js";

/**
 * task.ts -- a named task and its plan, its one current document.
 *
 * One row per task, keyed by a UUID of the service's own and owned by the
 * account that started it, in the workspace it was started in: its name, whether it is archived (a pin is each member's own, `plan-pin.ts`), its
 * one document, a free Markdown text, and the journal of the saves coding
 * agents made on it. A save replaces the
 * text in one statement, so none is left half-written: a save that failed
 * left the row as it stood. What the text held before is kept beside it, in
 * `plan_revision` (`plan-revision.ts`). The text is stored as written,
 * like the conversation, readable by an operator and kept the developer's
 * own by the account it is keyed by.
 *
 * The conversation a task resumes in is the one row it names, attached once
 * the brain opens it, and a purged conversation leaves the task
 * standing with none. The row cascades with its account, so deleting an
 * account is still one statement, and with its workspace.
 */
export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The workspace the task belongs to: a Better Auth `organization`, the starter's personal one unless another was named. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The task's number in its workspace, counted from one in the order its
     * tasks were made and never reused (`task_number_counter`), which its key (`ACME-42`,
     * `@luke/features/workspace-key`) is drawn from. A task moved to another
     * workspace takes the next number there.
     */
    number: integer("number").notNull(),
    /** Where the task stands (`TASK_STATUS`); apart from whether it is archived. */
    status: text("status").$type<TaskStatus>().notNull().default(TASK_STATUS.TODO),
    /** How much the task matters (`TASK_PRIORITY`); none until someone weighs it. */
    priority: text("priority").$type<TaskPriority>().notNull().default(TASK_PRIORITY.NONE),
    /** The saves coding agents made on the document, oldest first, the last fifty kept; empty until an agent saves. */
    agentEdits: jsonb("agent_edits")
      .$type<readonly PlanAgentEdit[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The plan as one free Markdown document, its whole text: no title line, and its assumptions a section like any other (`@luke/features/plan-document`). */
    document: text("document").notNull(),
    /**
     * The GitHub repository the task is about, `owner/name` as GitHub spells
     * it, confirmed reachable through the Luke GitHub App by the account
     * before it was written; null until one is chosen, which is where every
     * task from before repositories stands and is no error.
     */
    repository: text("repository"),
    /**
     * How the repository was reached as it was named: the workspace's GitHub
     * App, or the naming member's own token; the App's for a task with none.
     */
    githubAccess: text("github_access").$type<GitHubAccess>().notNull().default(GITHUB_ACCESS.APP),
    /**
     * @deprecated A task's issues are its links now, in `task_issue`
     * (`task-issue.ts`), and nothing writes or reads this. It was the one
     * Linear issue a task was started from, as the service read it then. It
     * stands until no running build reads it, then a later migration drops
     * it.
     */
    linearIssue: jsonb("linear_issue"),
    /**
     * The workspace's own issue the task was started from (`issue.ts`), one
     * of the same workspace, which a move to another workspace lets go;
     * null for a task started from none, and once the issue is deleted. An
     * issue may have many tasks, each an attempt at it.
     */
    issueId: uuid("issue_id").references(() => issue.id, { onDelete: "set null" }),
    /**
     * The developer's own words about the task as they started it, which
     * Luke is handed beside the plan to plan from; null for a task started
     * with none. Kept as written, like the document.
     */
    brief: text("brief"),
    /**
     * @deprecated A pin is its reader's own now, in `plan_pin`
     * (`plan-pin.ts`), and nothing writes or reads this. It was the
     * workspace's, so a pin one member made stood for every member. It stands
     * until no running build reads it, then a later migration drops it.
     */
    pinnedAt: timestamptz("pinned_at"),
    /** When the task was archived, which the list leaves out unless asked for it; null while it is not. */
    archivedAt: timestamptz("archived_at"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    /** The last save of the document; the start, before any. */
    updatedAt: updatedAt(),
  },
  (table) => [
    // The task list reads one account's tasks, newest started first.
    index("task_user_created").on(table.userId, table.createdAt),
    // A workspace's tasks, newest started first.
    index("task_organization_created").on(table.organizationId, table.createdAt),
    // An issue's tasks, and the issue's deletion letting each of them go. Note that it is not
    // named `task_issue`, because an index shares its name's namespace with the table of links.
    index("task_workspace_issue").on(table.issueId),
    // The key names one task of its workspace, and a new task takes the next number.
    uniqueIndex("task_organization_number").on(table.organizationId, table.number),
  ],
);

/**
 * The last number each workspace handed a task, so a task's number is
 * never handed out again, whether the task that took it was deleted or moved
 * to another workspace: a new task, or one moved in, takes one past it
 * (`task-store.ts`). A workspace has no row until its first task, and the
 * row goes with the workspace.
 */
export const taskNumberCounter = pgTable("task_number_counter", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  lastNumber: integer("last_number").notNull(),
});

/**
 * A task's whiteboard: the Excalidraw scene the Tasks tab shows, with the
 * number of Luke's drawing it holds, and Luke's latest drawing with its own
 * number. A task has no row until its board is first drawn on, and reads as
 * an empty board until then. Beside them stands the scene as the Mac drew it,
 * a PNG, from the first save that held each new drawing of Luke's, which is
 * what the brain looks at (`look_at_board`). The Mac writes the scene and Luke writes the
 * drawing, each whole and each the last write winning (`board-store.ts`).
 * The row goes with its task.
 */
export const taskBoard = pgTable("task_board", {
  taskId: uuid("task_id")
    .primaryKey()
    .references(() => task.id, { onDelete: "cascade" }),
  elements: jsonb("elements").$type<readonly BoardElement[]>().notNull().default(sql`'[]'::jsonb`),
  /** The number of Luke's drawing the scene holds; 0 before it holds any. */
  appliedDrawing: integer("applied_drawing").notNull().default(0),
  /** Luke's latest drawing; null before he drew. */
  drawing: jsonb("drawing").$type<readonly DrawingElement[]>(),
  /** The latest drawing's number, one more for each drawing; 0 before he drew. */
  drawingNumber: integer("drawing_number").notNull().default(0),
  /** The scene drawn as a PNG, base64, by the Mac's first save to hold drawing `applied_drawing`; null before one. */
  image: text("image"),
  updatedAt: updatedAt(),
});
