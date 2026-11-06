/**
 * task-history.ts -- one task's newest page of description history bound: its one statement, the tables it reads, the topics that wake it, and who it admits.
 *
 * The statement reads what `listRevisions` reads for its newest page: the
 * newest revisions, one past the page among them to say whether an older
 * page stands, with the member and the agent as their rows name them now,
 * and the revision a restore brought back, under the same account and rule
 * of who may read it, so a task the account does not reach is no rows. It
 * reads no clock, as Realtime requires. Older pages are read through
 * `listRevisions`.
 *
 * It is woken by a revision written or moved on, and by the task and its
 * agents, all of which name the task. Note that an editor's own name, read
 * beside each revision, wakes no history, because an account's row names
 * only it and its workspaces, and waking every open history in a workspace
 * on each of its writes is not worth a rename: one shows at the hold's end.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readTaskHeader } from "@repo/database/models/task-store";
import { taskSeenBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member, user } from "@repo/database/schemas/auth";
import { descriptionRevision } from "@repo/database/schemas/description-revision";
import { task } from "@repo/database/schemas/task";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  descriptionRevisionSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  taskSync,
  userSync,
} from "@repo/database/sync/tables";
import { TASK_HISTORY_READ } from "@repo/features/task-history-live";
import { DESCRIPTION_HISTORY_BOUNDS } from "@repo/features/task-wire";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement, outerJoined } from "../live-read-binding.js";

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
  return liveRowsStatement(
    TASK_HISTORY_READ.parts.revisions,
    {
      columns: {
        seq: descriptionRevision.seq,
        actor: descriptionRevision.actor,
        editorId: outerJoined(user.id),
        editorName: outerJoined(user.name),
        // No revision is written on a call any more; a released desktop still decodes the key.
        liveSessionId: sql<string | null>`null::text`,
        agentId: descriptionRevision.agentId,
        agentModel: outerJoined(agentTable.model),
        agentTitle: agentTable.title,
        // No call stands to name, since we take no calls; a released desktop still decodes the key.
        callId: sql<string | null>`null::text`,
        changes: descriptionRevision.changes,
        restoredFrom: descriptionRevision.restoredFrom,
      },
      instants: {
        at: descriptionRevision.at,
        startedAt: descriptionRevision.startedAt,
        restoredAt: outerJoined(restored.at),
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
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
        ),
  );
}

export const taskHistoryRead = bindLiveRead(TASK_HISTORY_READ, {
  reads: [
    descriptionRevisionSync,
    taskSync,
    agentSync,
    userSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, id }) => [
    [TOPIC.TASK, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({ revisions: revisionsStatement(userId, id) }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readTaskHeader(userId, id)), (task) =>
      Option.isNone(task) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
});
