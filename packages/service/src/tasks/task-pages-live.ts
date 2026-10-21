import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { taskSeenBy } from "@luke/database/models/workspace-store";
import { member } from "@luke/database/schemas/auth";
import { planPageVersion } from "@luke/database/schemas/plan-page";
import { task } from "@luke/database/schemas/task";
import { and, desc, eq } from "drizzle-orm";
import { Option } from "effect";

/**
 * task-pages-live.ts -- one task's pages, each at its newest version, written for Neon Realtime, so the window's Inbox holds a task's pages as they are shown rather than reading them again when a link names one it lacks.
 *
 * The statement reads what `listPages` reads, under the same account and
 * rule of who may read it, each column under the key `live-wire.ts` reads
 * it by and the instant in epoch milliseconds, so a task the account does
 * not reach is no rows. It reads no clock, as Realtime requires, and keeps
 * no order, which the reader keeps (`pagesOfLiveRows`).
 */

/** The statement one task's pages are followed by. */
export interface TaskPagesLiveStatements {
  readonly pages: LiveStatement;
}

/** Each page as `listPages` reads it: its newest version's line. */
function pagesStatement(userId: string, taskId: string) {
  // Note that the newest version is picked by `distinct on`, as the held read picks it.
  const newest = queryBuilder
    .selectDistinctOn([planPageVersion.pageId], {
      pageId: planPageVersion.pageId,
      title: planPageVersion.title,
      version: planPageVersion.version,
      at: planPageVersion.at,
      shownBy: planPageVersion.shownBy,
    })
    .from(planPageVersion)
    .innerJoin(task, eq(task.id, planPageVersion.taskId))
    // Note that membership is a join, as the board's live read reads it, rather than the held read's subquery.
    .innerJoin(
      member,
      and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
    )
    .where(and(eq(planPageVersion.taskId, taskId), taskSeenBy(userId)))
    .orderBy(planPageVersion.pageId, desc(planPageVersion.version))
    .as("newest");
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

/** The task's pages written for Realtime; none where the statement names a value Realtime cannot carry. */
export function taskPagesLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskPagesLiveStatements> {
  return Option.map(liveStatementOf(pagesStatement(userId, taskId)), (pages) => ({ pages }));
}
