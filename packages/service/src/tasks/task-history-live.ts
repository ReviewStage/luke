import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { agentGivenNameSql } from "@luke/database/models/agent-name";
import { taskSeenBy } from "@luke/database/models/workspace-store";
import { agentTable } from "@luke/database/schemas/agent";
import { member, user } from "@luke/database/schemas/auth";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { task } from "@luke/database/schemas/task";
import { PLAN_HISTORY_BOUNDS } from "@luke/features/task-wire";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Option } from "effect";

/**
 * task-history-live.ts -- one task's newest page of plan history, written for Neon Realtime, so the version history holds the revisions as saves land rather than reading them again on every edit of the task.
 *
 * The statement reads what `listRevisions` reads for its newest page: the
 * newest revisions, one past the page among them to say whether an older
 * page stands, with the member and the agent as their rows name them now,
 * and the revision a restore brought back,
 * under the same account and rule of who may read it, so a task the account
 * does not reach is no rows. Each column is under the key `live-wire.ts`
 * reads it by and each instant in epoch milliseconds. It reads no clock, as
 * Realtime requires, and keeps no order, which the reader keeps
 * (`revisionsOfLiveRows`). Older pages are read as before.
 */

/** The statement one task's newest page of history is followed by. */
export interface TaskHistoryLiveStatements {
  readonly revisions: LiveStatement;
}

/** The revision a restore brought back, read beside the restore that names it. */
const restored = alias(planRevision, "restored");

/** The newest revisions as `listRevisions` reads its newest page, one past the page among them. */
function revisionsStatement(userId: string, taskId: string) {
  const newest = queryBuilder
    .select({ seq: planRevision.seq })
    .from(planRevision)
    .where(eq(planRevision.taskId, taskId))
    .orderBy(desc(planRevision.seq))
    .limit(PLAN_HISTORY_BOUNDS.PAGE + 1);
  return (
    queryBuilder
      .select(
        liveSelection(
          {
            seq: planRevision.seq,
            actor: planRevision.actor,
            editorId: user.id,
            editorName: user.name,
            // No revision is written on a call any more; a released desktop still decodes the key.
            liveSessionId: sql<string | null>`null::text`,
            agentId: planRevision.agentId,
            agentModel: agentTable.model,
            // The name the agent goes by: Luke for an operator, else its title.
            agentTitle: sql<
              string | null
            >`coalesce(${agentGivenNameSql(agentTable)}, ${agentTable.title})`,
            // No call stands to name, since Luke takes no calls; a released desktop still decodes the key.
            callId: sql<string | null>`null::text`,
            changes: planRevision.changes,
            restoredFrom: planRevision.restoredFrom,
          },
          { at: planRevision.at, startedAt: planRevision.startedAt, restoredAt: restored.at },
        ),
      )
      .from(planRevision)
      .innerJoin(task, eq(task.id, planRevision.taskId))
      // Note that membership is a join, as the record's live read reads it, rather than the held read's subquery.
      .innerJoin(
        member,
        and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
      )
      .leftJoin(agentTable, eq(agentTable.id, planRevision.agentId))
      .leftJoin(user, eq(user.id, planRevision.userId))
      .leftJoin(
        restored,
        and(eq(restored.taskId, planRevision.taskId), eq(restored.seq, planRevision.restoredFrom)),
      )
      .where(
        and(eq(planRevision.taskId, taskId), taskSeenBy(userId), inArray(planRevision.seq, newest)),
      )
  );
}

/** The task's newest page of history written for Realtime; none where the statement names a value Realtime cannot carry. */
export function taskHistoryLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskHistoryLiveStatements> {
  return Option.map(liveStatementOf(revisionsStatement(userId, taskId)), (revisions) => ({
    revisions,
  }));
}
