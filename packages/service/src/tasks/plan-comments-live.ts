import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { taskSeenBy } from "@repo/database/models/workspace-store";
import { attachment } from "@repo/database/schemas/attachment";
import { member, user } from "@repo/database/schemas/auth";
import { planComment, planCommentThread } from "@repo/database/schemas/plan-comment";
import { task } from "@repo/database/schemas/task";
import { PLAN_COMMENT_ENTRY } from "@repo/features/plan-comment-wire";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { Option } from "effect";

/**
 * plan-comments-live.ts -- one subject of a task's comments, its plan's own threads or one page's on every version, written for Neon Realtime, so a surface showing them holds them as they are written rather than reading them again on every change of the task.
 *
 * The statements read what `readPlanCommentThreads` reads for one subject:
 * the threads, their entries with each member's name as their account
 * holds it now, and the files the comments carry without their bytes,
 * under the same account and rule of who may read the task, so a task the
 * account does not reach is no rows. Each column is under the key
 * `plan-comment-live.ts` reads it by, each instant in epoch milliseconds,
 * and each row carries what its rows are ordered by. They read no clock,
 * as Realtime requires, and keep no order, which the reader keeps
 * (`threadsOfLiveRows`).
 */

/** The statements one subject of a task's comments is followed by. */
export interface TaskCommentsLiveStatements {
  readonly threads: LiveStatement;
  readonly entries: LiveStatement;
  readonly files: LiveStatement;
}

/** Which of the task's threads a read follows: the plan's own where it names no page, or the page's it names. */
export interface TaskCommentsSubject {
  readonly taskId: string;
  readonly pageId?: string;
}

/** The subject's threads, on a task the account reaches: the plan's own where it names no page, the page's on every version otherwise. */
function onSubject(userId: string, { taskId, pageId }: TaskCommentsSubject): SQL | undefined {
  return and(
    eq(planCommentThread.taskId, taskId),
    pageId === undefined ? isNull(planCommentThread.pageId) : eq(planCommentThread.pageId, pageId),
    taskSeenBy(userId),
  );
}

/** The account's membership of the task's workspace, which each statement joins. Note that membership is a join, as the record's live read reads it, rather than the held read's subquery. */
function memberOfTask(userId: string): SQL | undefined {
  return and(eq(member.organizationId, task.organizationId), eq(member.userId, userId));
}

/** The subject's threads, as `findThreads` reads them. */
function threadsStatement(userId: string, subject: TaskCommentsSubject) {
  return queryBuilder
    .select(
      liveSelection(
        {
          id: planCommentThread.id,
          scope: planCommentThread.scope,
          quote: planCommentThread.quote,
          anchorFrom: planCommentThread.anchorFrom,
          anchorTo: planCommentThread.anchorTo,
          section: planCommentThread.section,
          pageId: planCommentThread.pageId,
          pageVersion: planCommentThread.pageVersion,
          pageElement: planCommentThread.pageElement,
          status: planCommentThread.status,
          revision: planCommentThread.revision,
        },
        { createdAt: planCommentThread.createdAt, updatedAt: planCommentThread.updatedAt },
      ),
    )
    .from(planCommentThread)
    .innerJoin(task, eq(task.id, planCommentThread.taskId))
    .innerJoin(member, memberOfTask(userId))
    .where(onSubject(userId, subject));
}

/** The entries of the subject's threads, as `findEntries` reads them, each with its place in its thread. */
function entriesStatement(userId: string, subject: TaskCommentsSubject) {
  return queryBuilder
    .select(
      liveSelection(
        {
          id: planComment.id,
          threadId: planComment.threadId,
          seq: planComment.seq,
          kind: planComment.kind,
          actor: planComment.actor,
          userId: planComment.userId,
          userName: user.name,
          agentId: planComment.agentId,
          words: planComment.words,
          askedActor: planComment.askedActor,
          askedAgentId: planComment.askedAgentId,
        },
        { createdAt: planComment.createdAt, editedAt: planComment.editedAt },
      ),
    )
    .from(planComment)
    .innerJoin(planCommentThread, eq(planCommentThread.id, planComment.threadId))
    .innerJoin(task, eq(task.id, planCommentThread.taskId))
    .innerJoin(member, memberOfTask(userId))
    .leftJoin(user, eq(user.id, planComment.userId))
    .where(and(eq(planComment.taskId, subject.taskId), onSubject(userId, subject)));
}

/** The files the subject's comments carry, without their bytes, as `findFiles` reads them, each with its place on its comment. */
function filesStatement(userId: string, subject: TaskCommentsSubject) {
  return queryBuilder
    .select(
      liveSelection({
        attachmentId: attachment.id,
        entryId: attachment.planCommentId,
        name: attachment.name,
        mediaType: attachment.contentType,
        position: attachment.position,
      }),
    )
    .from(attachment)
    .innerJoin(planComment, eq(planComment.id, attachment.planCommentId))
    .innerJoin(planCommentThread, eq(planCommentThread.id, planComment.threadId))
    .innerJoin(task, eq(task.id, planCommentThread.taskId))
    .innerJoin(member, memberOfTask(userId))
    .where(
      and(
        eq(attachment.taskId, subject.taskId),
        eq(planComment.kind, PLAN_COMMENT_ENTRY.COMMENT),
        onSubject(userId, subject),
      ),
    );
}

/** One subject of the task's comments written for Realtime; none where a statement names a value Realtime cannot carry. */
export function taskCommentsLiveStatements(
  userId: string,
  subject: TaskCommentsSubject,
): Option.Option<TaskCommentsLiveStatements> {
  return Option.all({
    threads: liveStatementOf(threadsStatement(userId, subject)),
    entries: liveStatementOf(entriesStatement(userId, subject)),
    files: liveStatementOf(filesStatement(userId, subject)),
  });
}
