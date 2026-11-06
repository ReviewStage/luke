import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { agentVisibleTo, taskSeenBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member } from "@repo/database/schemas/auth";
import { taskPageVersion } from "@repo/database/schemas/task-page";
import { task } from "@repo/database/schemas/task";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Option } from "effect";

export interface TaskPagesLiveStatements {
  readonly pages: LiveStatement;
}

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

const NEWEST_COLUMNS = {
  pageId: taskPageVersion.pageId,
  title: taskPageVersion.title,
  version: taskPageVersion.version,
  at: taskPageVersion.at,
  shownBy: taskPageVersion.shownBy,
};

function taskPagesNewest(userId: string, taskId: string) {
  return queryBuilder
    .selectDistinctOn([taskPageVersion.pageId], NEWEST_COLUMNS)
    .from(taskPageVersion)
    .innerJoin(task, eq(task.id, taskPageVersion.taskId))
    .innerJoin(
      member,
      and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
    )
    .where(and(eq(taskPageVersion.taskId, taskId), taskSeenBy(userId)))
    .orderBy(taskPageVersion.pageId, desc(taskPageVersion.version))
    .as("newest");
}

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

export function taskPagesLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskPagesLiveStatements> {
  return Option.map(liveStatementOf(newestLines(taskPagesNewest(userId, taskId))), (pages) => ({
    pages,
  }));
}

export function agentPagesLiveStatements(
  userId: string,
  agentId: string,
): Option.Option<TaskPagesLiveStatements> {
  return Option.map(liveStatementOf(newestLines(agentPagesNewest(userId, agentId))), (pages) => ({
    pages,
  }));
}
