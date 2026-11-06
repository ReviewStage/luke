import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { agentVisibleTo, taskSeenBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member } from "@repo/database/schemas/auth";
import { task } from "@repo/database/schemas/task";
import { taskPageVersion } from "@repo/database/schemas/task-page";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Option } from "effect";

/**
 * task-pages-live.ts -- one task's pages, or one coding agent's on no task, each at its newest version, written for Neon Realtime, so the window's Inbox and an agent's page hold the pages as they are shown rather than reading them again when a link names one it lacks.
 *
 * Each statement reads what `listPages` reads, under the same account and
 * rule of who may read it, the task's or the agent's, each column under the key `live-wire.ts` reads
 * it by and the instant in epoch milliseconds, so a task the account does
 * not reach is no rows. It reads no clock, as Realtime requires, and keeps
 * no order, which the reader keeps (`pagesOfLiveRows`).
 */

/** The statement one task's pages are followed by. */
export interface TaskPagesLiveStatements {
  readonly pages: LiveStatement;
}

/** The newest version of each page as Realtime is handed it, from the version subquery. */
function newestLines(newest: ReturnType<typeof taskPagesNewest>) {
  return queryBuilder
    .select(
      liveSelection(
        {
          id: newest.pageId,
          title: newest.title,
          version: newest.version,
          shownBy: newest.shownBy,
        },
        { at: newest.at },
      ),
    )
    .from(newest);
}

/** The columns each page's newest version is read with. */
const NEWEST_COLUMNS = {
  pageId: taskPageVersion.pageId,
  title: taskPageVersion.title,
  version: taskPageVersion.version,
  at: taskPageVersion.at,
  shownBy: taskPageVersion.shownBy,
};

/** Each page of the task by its newest version, as `listPages` reads it. */
function taskPagesNewest(userId: string, taskId: string) {
  // Note that the newest version is picked by `distinct on`, as the held read picks it.
  return (
    queryBuilder
      .selectDistinctOn([taskPageVersion.pageId], NEWEST_COLUMNS)
      .from(taskPageVersion)
      .innerJoin(task, eq(task.id, taskPageVersion.taskId))
      // Note that membership is a join, as the record's live read reads it, rather than the held read's subquery.
      .innerJoin(
        member,
        and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
      )
      .where(and(eq(taskPageVersion.taskId, taskId), taskSeenBy(userId)))
      .orderBy(taskPageVersion.pageId, desc(taskPageVersion.version))
      .as("newest")
  );
}

/** Each page of the coding agent on no task by its newest version, as `listPages` reads it, under the agent's rule of who may read it. */
function agentPagesNewest(userId: string, agentId: string) {
  return queryBuilder
    .selectDistinctOn([taskPageVersion.pageId], NEWEST_COLUMNS)
    .from(taskPageVersion)
    .innerJoin(agentTable, eq(agentTable.id, taskPageVersion.agentId))
    .where(
      and(
        isNull(taskPageVersion.taskId),
        eq(taskPageVersion.agentId, agentId),
        agentVisibleTo(userId),
      ),
    )
    .orderBy(taskPageVersion.pageId, desc(taskPageVersion.version))
    .as("newest");
}

/** The task's pages written for Realtime; none where the statement names a value Realtime cannot carry. */
export function taskPagesLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskPagesLiveStatements> {
  return Option.map(liveStatementOf(newestLines(taskPagesNewest(userId, taskId))), (pages) => ({
    pages,
  }));
}

/** The coding agent's own pages written for Realtime, on the terms a task's are. */
export function agentPagesLiveStatements(
  userId: string,
  agentId: string,
): Option.Option<TaskPagesLiveStatements> {
  return Option.map(liveStatementOf(newestLines(agentPagesNewest(userId, agentId))), (pages) => ({
    pages,
  }));
}
