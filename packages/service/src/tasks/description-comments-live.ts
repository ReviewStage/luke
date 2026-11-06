import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { taskSeenBy } from "@repo/database/models/workspace-store";
import { attachment } from "@repo/database/schemas/attachment";
import { member, user } from "@repo/database/schemas/auth";
import {
  descriptionComment,
  descriptionCommentThread,
} from "@repo/database/schemas/description-comment";
import { task } from "@repo/database/schemas/task";
import { DESCRIPTION_COMMENT_ENTRY } from "@repo/features/description-comment-wire";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { Option } from "effect";

export interface TaskCommentsLiveStatements {
  readonly threads: LiveStatement;
  readonly entries: LiveStatement;
  readonly files: LiveStatement;
}

export interface TaskCommentsSubject {
  readonly taskId: string;
  readonly pageId?: string;
}

function onSubject(userId: string, { taskId, pageId }: TaskCommentsSubject): SQL | undefined {
  return and(
    eq(descriptionCommentThread.taskId, taskId),
    pageId === undefined
      ? isNull(descriptionCommentThread.pageId)
      : eq(descriptionCommentThread.pageId, pageId),
    taskSeenBy(userId),
  );
}

function memberOfTask(userId: string): SQL | undefined {
  return and(eq(member.organizationId, task.organizationId), eq(member.userId, userId));
}

function threadsStatement(userId: string, subject: TaskCommentsSubject) {
  return queryBuilder
    .select(
      liveSelection(
        {
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
        {
          createdAt: descriptionCommentThread.createdAt,
          updatedAt: descriptionCommentThread.updatedAt,
        },
      ),
    )
    .from(descriptionCommentThread)
    .innerJoin(task, eq(task.id, descriptionCommentThread.taskId))
    .innerJoin(member, memberOfTask(userId))
    .where(onSubject(userId, subject));
}

function entriesStatement(userId: string, subject: TaskCommentsSubject) {
  return queryBuilder
    .select(
      liveSelection(
        {
          id: descriptionComment.id,
          threadId: descriptionComment.threadId,
          seq: descriptionComment.seq,
          kind: descriptionComment.kind,
          actor: descriptionComment.actor,
          userId: descriptionComment.userId,
          userName: user.name,
          agentId: descriptionComment.agentId,
          words: descriptionComment.words,
          askedActor: descriptionComment.askedActor,
          askedAgentId: descriptionComment.askedAgentId,
        },
        { createdAt: descriptionComment.createdAt, editedAt: descriptionComment.editedAt },
      ),
    )
    .from(descriptionComment)
    .innerJoin(
      descriptionCommentThread,
      eq(descriptionCommentThread.id, descriptionComment.threadId),
    )
    .innerJoin(task, eq(task.id, descriptionCommentThread.taskId))
    .innerJoin(member, memberOfTask(userId))
    .leftJoin(user, eq(user.id, descriptionComment.userId))
    .where(and(eq(descriptionComment.taskId, subject.taskId), onSubject(userId, subject)));
}

function filesStatement(userId: string, subject: TaskCommentsSubject) {
  return queryBuilder
    .select(
      liveSelection({
        attachmentId: attachment.id,
        entryId: attachment.descriptionCommentId,
        name: attachment.name,
        mediaType: attachment.contentType,
        position: attachment.position,
      }),
    )
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
    );
}

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
