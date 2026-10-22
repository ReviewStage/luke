import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { agentSeenBy, taskSeenBy } from "@luke/database/models/workspace-store";
import { member } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { planPageVersion } from "@luke/database/schemas/plan-page";
import { messages } from "@luke/database/schemas/storage";
import { task } from "@luke/database/schemas/task";
import { voiceSessions, voiceTranscriptSegments } from "@luke/database/schemas/voice";
import { toolPartType } from "@luke/features/brain";
import { and, eq, max, sql } from "drizzle-orm";
import { Option } from "effect";
import { ACTION_RESULT_STATUS, TOOL_PART_STATE } from "../core.js";
import { SHOW_CODE_TOOL } from "./show-code.js";

/**
 * task-record-live.ts -- where an open task's pages, calls, and the code its agents showed stand, written for Neon Realtime, so the desktop reads each again the moment its rows move rather than when a call's activity or end suggests they might have.
 *
 * Three parts, each a mark and none of the words it marks: the pages agents
 * showed (`pages`), one row a page at its newest version; the task's
 * calls (`calls`), one row a call that has words, which moves as its words
 * land, as it closes, and as its metering and the rows the voice wrote for
 * it land after; and the code the task's agents showed (`code`), one row a
 * journal holding an accepted `show_code` answer, marked by those calls' ids
 * alone, so it moves as a call's lines land and not as the rest of a running
 * turn's journal is written in batches around them. The board is followed on its own (`boardLiveStatement`).
 * Each statement reads what its held read reads (`listPages`,
 * `readTaskCode`), the account joined through its membership of the
 * task's workspace and held to the task's GitHub access, as the board's
 * live read is, so a task the account does not reach is no rows. None reads
 * the clock, as Realtime requires.
 */

/** The statements an open task's record is followed by, one a part. */
export interface TaskRecordLiveStatements {
  readonly pages: LiveStatement;
  readonly calls: LiveStatement;
  readonly code: LiveStatement;
}

/** A `show_code` part as an accepted answer stands in a journal, as the code's held read takes one (`shownCodeOf`). */
const ANSWERED_SHOW_CODE = {
  type: toolPartType(SHOW_CODE_TOOL.name),
  state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
  output: { status: ACTION_RESULT_STATUS.ACCEPTED },
} as const;

/** The ids of a journal's accepted `show_code` calls, in the order the journal holds them, as a JSON path. */
const ANSWERED_SHOW_CODE_IDS = `$[*] ? (@.type == "${ANSWERED_SHOW_CODE.type}" && @.state == "${ANSWERED_SHOW_CODE.state}" && @.output.status == "${ANSWERED_SHOW_CODE.output.status}").toolCallId`;

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
 * Each call about the task, marked: one with words, since a call with none
 * reads as no call; how it ended, what it metered, and its model, as its
 * session row holds them; and its last fragment, since fragments are only
 * ever appended. Note that `spoken`, the rows the voice wrote for it in the
 * task's own conversation, is always none now that every call speaks into
 * an agent's; it stands so a desktop that still reads it decodes the part.
 */
function callsStatement(userId: string, taskId: string) {
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
      spoken: sql<number>`0`.as("spoken"),
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

/**
 * Each journal of an agent on the task that holds an accepted `show_code`
 * answer, marked by the ids of those calls alone, as text: a later step of
 * the same turn rewrites the journal and leaves its mark as it stood. Read
 * under the agent's starter, whose conversation it is, as the held read is.
 */
function codeStatement(userId: string, taskId: string) {
  return queryBuilder
    .select({
      ...liveSelection({ id: messages.id }),
      calls:
        sql<string>`jsonb_path_query_array(${messages.parts}, ${ANSWERED_SHOW_CODE_IDS}::jsonpath)::text`.as(
          "calls",
        ),
    })
    .from(messages)
    .innerJoin(
      codingAgent,
      and(
        eq(codingAgent.conversationId, messages.conversationId),
        eq(codingAgent.userId, messages.userId),
      ),
    )
    .innerJoin(task, eq(task.id, codingAgent.taskId))
    .innerJoin(member, memberOfTask(userId))
    .where(
      and(
        eq(codingAgent.taskId, taskId),
        taskSeenBy(userId),
        agentSeenBy(userId),
        sql`${messages.parts} @> ${JSON.stringify([ANSWERED_SHOW_CODE])}::jsonb`,
      ),
    );
}

/** The task's record written for Realtime; none where a statement names a value Realtime cannot carry. */
export function taskRecordLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<TaskRecordLiveStatements> {
  return Option.all({
    pages: liveStatementOf(pagesStatement(userId, taskId)),
    calls: liveStatementOf(callsStatement(userId, taskId)),
    code: liveStatementOf(codeStatement(userId, taskId)),
  });
}
