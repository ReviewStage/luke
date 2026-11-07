/**
 * task-record.ts -- where an open task's description, pages, calls, and the code its agents showed stand, bound: a statement a part, the tables they read, the topics that wake them, and who they admit.
 *
 * Four parts, each a mark and none of the words it marks: the description's
 * text, one row marked by its last save, which only a save of the text
 * moves, whoever wrote it; the pages agents showed, one row a page at its
 * newest version; the task's calls, which answers no rows now that we take
 * no calls; and the code the task's agents showed, which answers no rows
 * now that no agent shows code. Each statement reads what its held read
 * reads (`listPages`), the account joined through its membership of the
 * task's workspace and held to the task's GitHub access, so a task the
 * account does not reach is no rows. None reads the clock, as Realtime
 * requires.
 *
 * It is woken by a save of the task and a page shown on it, both of which
 * name the task, and by what admits the reader to it.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readTaskHeader } from "@repo/database/models/task-store";
import { taskSeenBy } from "@repo/database/models/workspace-store";
import { member } from "@repo/database/schemas/auth";
import { task } from "@repo/database/schemas/task";
import { taskPageVersion } from "@repo/database/schemas/task-page";
import { TOPIC } from "@repo/database/sync/notification";
import {
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  taskPageVersionSync,
  taskSync,
} from "@repo/database/sync/tables";
import { TASK_RECORD_READ } from "@repo/features/task-record-live";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

/** The account's membership of the task's workspace, which a live read joins rather than asks, as Neon's guide authorizes one. */
function memberOfTask(userId: string) {
  return and(eq(member.organizationId, task.organizationId), eq(member.userId, userId));
}

/**
 * The description marked by its last save, as the open document reads it
 * (`Task.updatedAt`): a rename, a status, or a pin is no save, so none of
 * them moves it, and a save by anyone does.
 */
function descriptionStatement(userId: string, taskId: string) {
  return liveRowsStatement(
    TASK_RECORD_READ.parts.description,
    { ordered: false, columns: { taskId: task.id }, instants: { savedAt: task.updatedAt } },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(task)
        .innerJoin(member, memberOfTask(userId))
        .where(and(eq(task.id, taskId), taskSeenBy(userId))),
  );
}

/** Each page as `listPages` reads it, marked by its newest version's number: a version is written once and never changed. */
function pagesStatement(userId: string, taskId: string) {
  return liveRowsStatement(
    TASK_RECORD_READ.parts.pages,
    {
      ordered: false,
      columns: {
        pageId: taskPageVersion.pageId,
        version: sql<number>`max(${taskPageVersion.version})`,
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(taskPageVersion)
        .innerJoin(task, eq(task.id, taskPageVersion.taskId))
        .innerJoin(member, memberOfTask(userId))
        .where(and(eq(taskPageVersion.taskId, taskId), taskSeenBy(userId)))
        .groupBy(taskPageVersion.pageId),
  );
}

/** A part a released desktop still follows and decodes, which answers no rows: the task's calls, since we take no calls, or the code its agents showed, since no agent shows code. */
function noRowsStatement() {
  return liveRowsStatement(
    TASK_RECORD_READ.parts.calls,
    { ordered: false, columns: { id: task.id } },
    (selection) => queryBuilder.select(selection).from(task).where(sql`false`),
  );
}

export const taskRecordRead = bindLiveRead(TASK_RECORD_READ, {
  reads: [
    taskSync,
    taskPageVersionSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, id }) => [
    [TOPIC.TASK, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({
    description: descriptionStatement(userId, id),
    pages: pagesStatement(userId, id),
    calls: noRowsStatement(),
    code: noRowsStatement(),
  }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readTaskHeader(userId, id)), (task) =>
      Option.isNone(task) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
});
