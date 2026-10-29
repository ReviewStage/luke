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
import { and, eq, max, sql } from "drizzle-orm";
import { Option } from "effect";

/**
 * task-record-live.ts -- where an open task's plan, pages, calls, and the code its agents showed stand, written for Neon Realtime, so the desktop reads each again the moment its rows move.
 *
 * Four parts, each a mark and none of the words it marks: the plan's text
 * (`plan`), one row marked by its last save, which only a save of the text
 * moves, whoever wrote it; the pages agents
 * showed (`pages`), one row a page at its newest version; the task's
 * calls (`calls`), which answers no rows now that Luke takes no calls; and
 * the code the task's agents showed (`code`), which answers no rows now that
 * no agent shows code. Each statement reads what its held read reads
 * (`listPages`), the account joined through its membership of the task's
 * workspace and held to the task's GitHub access, so a task the account does
 * not reach is no rows. None reads the clock, as Realtime requires.
 */

/** The statements an open task's record is followed by, one a part. */
export interface TaskRecordLiveStatements {
  readonly plan: LiveStatement;
  readonly pages: LiveStatement;
  readonly calls: LiveStatement;
  readonly code: LiveStatement;
}

/** The account's membership of the task's workspace, which a live read joins rather than asks, as Neon's guide authorizes one. */
function memberOfTask(userId: string) {
  return and(eq(member.organizationId, task.organizationId), eq(member.userId, userId));
}

/**
 * The plan marked by its last save, as the open document reads it
 * (`Task.updatedAt`): a rename, a status, or a pin is no save, so none of
 * them moves it, and a save by anyone does.
 */
function planStatement(userId: string, taskId: string) {
  return queryBuilder
    .select(liveSelection({ taskId: task.id }, { savedAt: task.updatedAt }))
    .from(task)
    .innerJoin(member, memberOfTask(userId))
    .where(and(eq(task.id, taskId), taskSeenBy(userId)));
}

/** Each page as `listPages` reads it, marked by its newest version's number: a version is written once and never changed. */
function pagesStatement(userId: string, taskId: string) {
  return queryBuilder
    .select({
      ...liveSelection({ pageId: planPageVersion.pageId }),
      version: max(planPageVersion.version).as("version"),
    })
    .from(planPageVersion)
    .innerJoin(task, eq(task.id, planPageVersion.taskId))
    .innerJoin(member, memberOfTask(userId))
    .where(and(eq(planPageVersion.taskId, taskId), taskSeenBy(userId)))
    .groupBy(planPageVersion.pageId);
}

/**
 * The task's calls: none, since Luke takes no calls. A released desktop
 * still follows the part and decodes it, so it stands, answering no rows.
 */
function callsStatement() {
  return queryBuilder
    .select(liveSelection({ id: task.id }))
    .from(task)
    .where(sql`false`);
}

/**
 * The code the task's agents showed: none, since no agent shows code. A
 * released desktop still follows the part and decodes it, so it stands,
 * answering no rows.
 */
function codeStatement() {
  return queryBuilder
    .select(liveSelection({ id: task.id }))
    .from(task)
    .where(sql`false`);
}

/** The task's record written for Realtime; none where a statement names a value Realtime cannot carry. */
export function taskRecordLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskRecordLiveStatements> {
  return Option.all({
    plan: liveStatementOf(planStatement(userId, taskId)),
    pages: liveStatementOf(pagesStatement(userId, taskId)),
    calls: liveStatementOf(callsStatement()),
    code: liveStatementOf(codeStatement()),
  });
}
