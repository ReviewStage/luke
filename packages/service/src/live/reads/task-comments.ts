/**
 * task-comments.ts -- one subject of a task's comments, its description's own threads or one page's on every version, bound: its statements, the tables they read, the topics that wake it, and who it admits.
 *
 * The statements read what `readDescriptionCommentThreads` reads for one
 * subject: the threads, their entries with each member's name as their
 * account holds it now, and the files the comments carry without their
 * bytes, under the same account and rule of who may read the task, so a
 * task the account does not reach is no rows. They read no clock, as
 * Realtime requires.
 *
 * It is woken by a thread or an entry written, a file kept on a comment,
 * and the task itself, all of which name the task. Note that a writer's own
 * name, read beside each entry, wakes no comments, as the history's
 * editor's wakes no history: one shows at the hold's end.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readTaskHeader } from "@repo/database/models/task-store";
import { taskSeenBy } from "@repo/database/models/workspace-store";
import { attachment } from "@repo/database/schemas/attachment";
import { member, user } from "@repo/database/schemas/auth";
import {
  descriptionComment,
  descriptionCommentThread,
} from "@repo/database/schemas/description-comment";
import { task } from "@repo/database/schemas/task";
import { TOPIC } from "@repo/database/sync/notification";
import {
  attachmentSync,
  descriptionCommentSync,
  descriptionCommentThreadSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  taskSync,
  userSync,
} from "@repo/database/sync/tables";
import { TASK_COMMENTS_READ } from "@repo/features/description-comment-live";
import { DESCRIPTION_COMMENT_ENTRY } from "@repo/features/description-comment-wire";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement, outerJoined } from "../live-read-binding.js";

/** The page a comments read binds where its query names none: the description's own threads. */
const DESCRIPTION_THREADS = "";

/** Which of the task's threads a read follows: the description's own where it names no page, or the page's it names. */
interface TaskCommentsSubject {
  readonly taskId: string;
  readonly pageId?: string;
}

/** The subject's threads, on a task the account reaches: the description's own where it names no page, the page's on every version otherwise. */
function onSubject(userId: string, { taskId, pageId }: TaskCommentsSubject): SQL | undefined {
  return and(
    eq(descriptionCommentThread.taskId, taskId),
    pageId === undefined
      ? isNull(descriptionCommentThread.pageId)
      : eq(descriptionCommentThread.pageId, pageId),
    taskSeenBy(userId),
  );
}

/** The account's membership of the task's workspace, which each statement joins. Note that membership is a join, as the record's live read reads it, rather than the held read's subquery. */
function memberOfTask(userId: string): SQL | undefined {
  return and(eq(member.organizationId, task.organizationId), eq(member.userId, userId));
}

/** The subject's threads, as `findThreads` reads them. */
function threadsStatement(userId: string, subject: TaskCommentsSubject) {
  return liveRowsStatement(
    TASK_COMMENTS_READ.parts.threads,
    {
      ordered: false,
      columns: {
        id: descriptionCommentThread.id,
        scope: descriptionCommentThread.scope,
        quote: descriptionCommentThread.quote,
        anchorFrom: descriptionCommentThread.anchorFrom,
        anchorTo: descriptionCommentThread.anchorTo,
        section: descriptionCommentThread.section,
        pageId: descriptionCommentThread.pageId,
        pageVersion: descriptionCommentThread.pageVersion,
        pageElement: descriptionCommentThread.pageElement,
        status: descriptionCommentThread.status,
        revision: descriptionCommentThread.revision,
      },
      instants: {
        createdAt: descriptionCommentThread.createdAt,
        updatedAt: descriptionCommentThread.updatedAt,
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(descriptionCommentThread)
        .innerJoin(task, eq(task.id, descriptionCommentThread.taskId))
        .innerJoin(member, memberOfTask(userId))
        .where(onSubject(userId, subject)),
  );
}

/** The entries of the subject's threads, as `findEntries` reads them, each with its place in its thread. */
function entriesStatement(userId: string, subject: TaskCommentsSubject) {
  return liveRowsStatement(
    TASK_COMMENTS_READ.parts.entries,
    {
      ordered: false,
      columns: {
        id: descriptionComment.id,
        threadId: descriptionComment.threadId,
        seq: descriptionComment.seq,
        kind: descriptionComment.kind,
        actor: descriptionComment.actor,
        userId: descriptionComment.userId,
        userName: outerJoined(user.name),
        agentId: descriptionComment.agentId,
        words: descriptionComment.words,
        askedActor: descriptionComment.askedActor,
        askedAgentId: descriptionComment.askedAgentId,
      },
      instants: { createdAt: descriptionComment.createdAt, editedAt: descriptionComment.editedAt },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(descriptionComment)
        .innerJoin(
          descriptionCommentThread,
          eq(descriptionCommentThread.id, descriptionComment.threadId),
        )
        .innerJoin(task, eq(task.id, descriptionCommentThread.taskId))
        .innerJoin(member, memberOfTask(userId))
        .leftJoin(user, eq(user.id, descriptionComment.userId))
        .where(and(eq(descriptionComment.taskId, subject.taskId), onSubject(userId, subject))),
  );
}

/** The files the subject's comments carry, without their bytes, as `findFiles` reads them, each with its place on its comment. */
function filesStatement(userId: string, subject: TaskCommentsSubject) {
  return liveRowsStatement(
    TASK_COMMENTS_READ.parts.files,
    {
      ordered: false,
      columns: {
        attachmentId: attachment.id,
        // Note that a file kept on no comment is joined out, so the comment it stands on is never null here, as `findFiles` reads it.
        entryId: sql<string>`${attachment.descriptionCommentId}`,
        // Note that a comment's file is kept under its name, as `findFiles` reads it.
        name: sql<string>`${attachment.name}`,
        mediaType: attachment.contentType,
        position: attachment.position,
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(attachment)
        .innerJoin(descriptionComment, eq(descriptionComment.id, attachment.descriptionCommentId))
        .innerJoin(
          descriptionCommentThread,
          eq(descriptionCommentThread.id, descriptionComment.threadId),
        )
        .innerJoin(task, eq(task.id, descriptionCommentThread.taskId))
        .innerJoin(member, memberOfTask(userId))
        .where(
          and(
            eq(attachment.taskId, subject.taskId),
            eq(descriptionComment.kind, DESCRIPTION_COMMENT_ENTRY.COMMENT),
            onSubject(userId, subject),
          ),
        ),
  );
}

export const taskCommentsRead = bindLiveRead(TASK_COMMENTS_READ, {
  reads: [
    descriptionCommentThreadSync,
    descriptionCommentSync,
    attachmentSync,
    userSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, id }) => [
    [TOPIC.TASK, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id, page }) => {
    const subject = page === DESCRIPTION_THREADS ? { taskId: id } : { taskId: id, pageId: page };
    return {
      threads: threadsStatement(userId, subject),
      entries: entriesStatement(userId, subject),
      files: filesStatement(userId, subject),
    };
  },
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readTaskHeader(userId, id)), (task) =>
      Option.isNone(task) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
});
