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

/**
 * task-history-live.ts -- one task's newest page of description history, written for Neon Realtime, so the version history holds the revisions as saves land rather than reading them again on every edit of the task.
 *
 * The statement reads what `listRevisions` reads for its newest page: the
 * newest revisions, one past the page among them to say whether an older
 * page stands, with the member and the agent as their rows name them now,
 * and the revision a restore brought back,
 * under the same account and rule of who may read it, so a task the account
 * does not reach is no rows. Each column is under the key `live-wire.ts`
 * reads it by and each instant in epoch milliseconds. It reads no clock, as
 * Realtime requires, and keeps no order, which the reader keeps
 * (`revisionsOfLiveRows`). Older pages are read through `listRevisions`.
 */

/** The statement one task's newest page of history is followed by. */
export interface TaskHistoryLiveStatements {
  readonly revisions: LiveStatement;
}

/** The revision a restore brought back, read beside the restore that names it. */
const restored = alias(descriptionRevision, "restored");

/** The newest revisions as `listRevisions` reads its newest page, one past the page among them. */
function revisionsStatement(userId: string, taskId: string) {
  const newest = queryBuilder
    .select({ seq: descriptionRevision.seq })
    .from(descriptionRevision)
    .where(eq(descriptionRevision.taskId, taskId))
    .orderBy(desc(descriptionRevision.seq))
    .limit(DESCRIPTION_HISTORY_BOUNDS.PAGE + 1);
  return (
    queryBuilder
      .select(
        liveSelection(
          {
            seq: descriptionRevision.seq,
            actor: descriptionRevision.actor,
            editorId: user.id,
            editorName: user.name,
            // No revision is written on a call any more; a released desktop still decodes the key.
            liveSessionId: sql<string | null>`null::text`,
            agentId: descriptionRevision.agentId,
            agentModel: agentTable.model,
            agentTitle: agentTable.title,
            // No call stands to name, since we take no calls; a released desktop still decodes the key.
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
      // Note that membership is a join, as the record's live read reads it, rather than the held read's subquery.
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
