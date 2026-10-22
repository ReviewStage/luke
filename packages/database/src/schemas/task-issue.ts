import {
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueProvider,
  type TaskIssueRelation,
} from "@luke/features/task-issue-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers.js";
import { user } from "./auth.js";
import { task } from "./task.js";

/**
 * task-issue.ts -- the external issues a task links, one row per task and issue.
 *
 * A task links any number of Linear's or GitHub's issues, at most
 * `TASK_BOUNDS.MAX_ISSUES`, which the store refuses past
 * (`task-issue-store.ts`), each through a row of the same shape whatever its
 * provider (`@luke/features/task-issue-wire`). A row names its issue by the
 * provider's own id and keeps what a chip draws of it, refreshed as the
 * issue is read, and the description an agent's brief reads, copied when
 * the link was made, so a brief still reads it once the provider is
 * disconnected. The issue's state, assignee, and labels are the provider's,
 * read live and never kept here. Several tasks may link one issue, and a
 * task's first link names its agents' branches. The row goes with its task,
 * and outlives the member who made it.
 */
export const taskIssue = pgTable(
  "task_issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    provider: text("provider").$type<TaskIssueProvider>().notNull(),
    /** The provider's own id for the issue, which survives a team move or a repository rename: Linear's issue UUID, or GitHub's node id (`I_kwDO…`). */
    externalId: text("external_id").notNull(),
    /** The repository a GitHub issue is filed in, `owner/name`, as `Closes owner/name#45` names it; null on a Linear row. */
    repository: text("repository"),
    /** A GitHub issue's number in its repository; null on a Linear row. */
    number: integer("number"),
    /** What the issue is called, `ENG-123` or `owner/name#45`: a chip's words, refreshed as the issue is read and never the source of truth. */
    key: text("key").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    /** The issue's description as Markdown, at most `LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS`, as it read when the link was made; empty where it had none. */
    description: text("description").notNull(),
    /** Which keyword a coding agent writes of the issue in its pull request (`TASK_ISSUE_RELATION`). */
    relation: text("relation")
      .$type<TaskIssueRelation>()
      .notNull()
      .default(TASK_ISSUE_RELATION.CLOSES),
    /** The member who made the link; null once their account is gone. */
    linkedBy: text("linked_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    // A task links an issue once; its links are read, oldest first, by the task.
    uniqueIndex("task_issue_task_provider_external").on(
      table.taskId,
      table.provider,
      table.externalId,
    ),
    // Every task that links one issue, as a webhook or a pasted link finds them.
    index("task_issue_provider_external").on(table.provider, table.externalId),
    // A GitHub issue is named by its repository and number, which its keyword spells.
    check(
      "task_issue_github_numbered",
      sql`${table.provider} <> ${sql.raw(`'${TASK_ISSUE_PROVIDER.GITHUB}'`)} or (${table.repository} is not null and ${table.number} is not null)`,
    ),
  ],
);
