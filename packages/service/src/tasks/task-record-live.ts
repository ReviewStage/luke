import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { taskSeenBy } from "@repo/database/models/workspace-store";
import { member } from "@repo/database/schemas/auth";
import { taskPageVersion } from "@repo/database/schemas/task-page";
import { task } from "@repo/database/schemas/task";
import { and, eq, max, sql } from "drizzle-orm";
import { Option } from "effect";

export interface TaskRecordLiveStatements {
  readonly description: LiveStatement;
  readonly pages: LiveStatement;
  readonly calls: LiveStatement;
  readonly code: LiveStatement;
}

function memberOfTask(userId: string) {
  return and(eq(member.organizationId, task.organizationId), eq(member.userId, userId));
}

function descriptionStatement(userId: string, taskId: string) {
  return queryBuilder
    .select(liveSelection({ taskId: task.id }, { savedAt: task.updatedAt }))
    .from(task)
    .innerJoin(member, memberOfTask(userId))
    .where(and(eq(task.id, taskId), taskSeenBy(userId)));
}

function pagesStatement(userId: string, taskId: string) {
  return queryBuilder
    .select({
      ...liveSelection({ pageId: taskPageVersion.pageId }),
      version: max(taskPageVersion.version).as("version"),
    })
    .from(taskPageVersion)
    .innerJoin(task, eq(task.id, taskPageVersion.taskId))
    .innerJoin(member, memberOfTask(userId))
    .where(and(eq(taskPageVersion.taskId, taskId), taskSeenBy(userId)))
    .groupBy(taskPageVersion.pageId);
}

function callsStatement() {
  return queryBuilder
    .select(liveSelection({ id: task.id }))
    .from(task)
    .where(sql`false`);
}

function codeStatement() {
  return queryBuilder
    .select(liveSelection({ id: task.id }))
    .from(task)
    .where(sql`false`);
}

export function taskRecordLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskRecordLiveStatements> {
  return Option.all({
    description: liveStatementOf(descriptionStatement(userId, taskId)),
    pages: liveStatementOf(pagesStatement(userId, taskId)),
    calls: liveStatementOf(callsStatement()),
    code: liveStatementOf(codeStatement()),
  });
}
