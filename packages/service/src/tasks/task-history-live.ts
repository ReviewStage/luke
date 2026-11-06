import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { taskSeenBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member, user } from "@repo/database/schemas/auth";
import { descriptionRevision } from "@repo/database/schemas/description-revision";
import { task } from "@repo/database/schemas/task";
import { DESCRIPTION_HISTORY_BOUNDS } from "@repo/features/task-wire";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Option } from "effect";

export interface TaskHistoryLiveStatements {
  readonly revisions: LiveStatement;
}

const restored = alias(descriptionRevision, "restored");

function revisionsStatement(userId: string, taskId: string) {
  const newest = queryBuilder
    .select({ seq: descriptionRevision.seq })
    .from(descriptionRevision)
    .where(eq(descriptionRevision.taskId, taskId))
    .orderBy(desc(descriptionRevision.seq))
    .limit(DESCRIPTION_HISTORY_BOUNDS.PAGE + 1);
  return queryBuilder
    .select(
      liveSelection(
        {
          seq: descriptionRevision.seq,
          actor: descriptionRevision.actor,
          editorId: user.id,
          editorName: user.name,
          liveSessionId: sql<string | null>`null::text`,
          agentId: descriptionRevision.agentId,
          agentModel: agentTable.model,
          agentTitle: agentTable.title,
          callId: sql<string | null>`null::text`,
          changes: descriptionRevision.changes,
          restoredFrom: descriptionRevision.restoredFrom,
        },
        {
          at: descriptionRevision.at,
          startedAt: descriptionRevision.startedAt,
          restoredAt: restored.at,
        },
      ),
    )
    .from(descriptionRevision)
    .innerJoin(task, eq(task.id, descriptionRevision.taskId))
    .innerJoin(
      member,
      and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
    )
    .leftJoin(agentTable, eq(agentTable.id, descriptionRevision.agentId))
    .leftJoin(user, eq(user.id, descriptionRevision.userId))
    .leftJoin(
      restored,
      and(
        eq(restored.taskId, descriptionRevision.taskId),
        eq(restored.seq, descriptionRevision.restoredFrom),
      ),
    )
    .where(
      and(
        eq(descriptionRevision.taskId, taskId),
        taskSeenBy(userId),
        inArray(descriptionRevision.seq, newest),
      ),
    );
}

export function taskHistoryLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskHistoryLiveStatements> {
  return Option.map(liveStatementOf(revisionsStatement(userId, taskId)), (revisions) => ({
    revisions,
  }));
}
