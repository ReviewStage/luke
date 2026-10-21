import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { taskSeenBy } from "@luke/database/models/workspace-store";
import { member } from "@luke/database/schemas/auth";
import { planPageVersion } from "@luke/database/schemas/plan-page";
import { messages } from "@luke/database/schemas/storage";
import { task } from "@luke/database/schemas/task";
import { voiceSessions, voiceTranscriptSegments } from "@luke/database/schemas/voice";
import { and, eq, isNotNull, max, sql } from "drizzle-orm";
import { Option } from "effect";

/**
 * task-record-live.ts -- where an open task's pages and calls stand, written for Neon Realtime, so the desktop reads either again the moment its rows move rather than when a call's activity or end suggests they might have.
 *
 * Two parts, each a mark and none of the words it marks: the pages agents
 * showed (`pages`), one row a page at its newest version; and the task's
 * calls (`calls`), one row a call that has words, which moves as its words
 * land, as it closes, and as its metering and the rows the voice wrote for
 * it land after. The board is followed on its own (`boardLiveStatement`).
 * Each statement reads what its held read reads (`listPages`,
 * `readTranscript`), the account joined through its membership of the
 * task's workspace and held to the task's GitHub access, as the board's
 * live read is, so a task the account does not reach is no rows. None reads
 * the clock, as Realtime requires.
 */

/** The statements an open task's record is followed by, one a part. */
export interface TaskRecordLiveStatements {
  readonly pages: LiveStatement;
  readonly calls: LiveStatement;
}

/** The account's membership of the task's workspace, which a live read joins rather than asks, as Neon's guide authorizes one. */
function memberOfTask(userId: string) {
  return and(eq(member.organizationId, task.organizationId), eq(member.userId, userId));
}

/** Each page as `listPages` reads it, marked by its newest version's number: a version is written once and never changed. */
function pagesStatement(userId: string, taskId: string) {
  return queryBuilder
    .select({
      ...liveSelection({ pageId: planPageVersion.pageId }),
      version: max(planPageVersion.version).as("version"),
    })
    .from(planPageVersion)
    .innerJoin(task, eq(task.id, planPageVersion.taskId))
    .innerJoin(member, memberOfTask(userId))
    .where(and(eq(planPageVersion.taskId, taskId), taskSeenBy(userId)))
    .groupBy(planPageVersion.pageId);
}

/**
 * Each call `readTranscript` reads, marked: one with words, since a call
 * with none reads as no call; how it ended, what it metered, and its model,
 * as its session row holds them; its last fragment, since fragments are
 * only ever appended; and how many rows the voice wrote for it in the task's
 * conversation, which name its lines.
 */
function callsStatement(userId: string, taskId: string) {
  const spoken = queryBuilder
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.conversationId, task.conversationId),
        sql`${messages.metadata}->>'voice_session_id' = ${voiceSessions.id}::text`,
        isNotNull(sql`${messages.metadata}->>'from_ms'`),
      ),
    );
  return queryBuilder
    .select({
      ...liveSelection(
        {
          id: voiceSessions.id,
          closeReason: voiceSessions.closeReason,
          usage: voiceSessions.usage,
          model: voiceSessions.model,
        },
        { closedAt: voiceSessions.closedAt },
      ),
      lastSegment: max(voiceTranscriptSegments.seq).as("lastSegment"),
      spoken: sql<number>`(${spoken})`.as("spoken"),
    })
    .from(voiceSessions)
    .innerJoin(task, eq(task.id, voiceSessions.taskId))
    .innerJoin(member, memberOfTask(userId))
    .innerJoin(
      voiceTranscriptSegments,
      eq(voiceTranscriptSegments.voiceSessionId, voiceSessions.id),
    )
    .where(and(eq(voiceSessions.taskId, taskId), taskSeenBy(userId)))
    .groupBy(voiceSessions.id, task.id);
}

/** The task's record written for Realtime; none where a statement names a value Realtime cannot carry. */
export function taskRecordLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskRecordLiveStatements> {
  return Option.all({
    pages: liveStatementOf(pagesStatement(userId, taskId)),
    calls: liveStatementOf(callsStatement(userId, taskId)),
  });
}
