import {
  LIVE_COUNT,
  type LiveStatement,
  liveLatest,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { reachableTask } from "@luke/database/models/workspace-store";
import { task, taskBoard } from "@luke/database/schemas/plan";
import { planPageVersion } from "@luke/database/schemas/plan-page";
import { voiceSessions, voiceTranscriptSegments } from "@luke/database/schemas/voice";
import { and, eq, max, sql } from "drizzle-orm";
import { Option } from "effect";

/**
 * plan-record-live.ts -- what the open plan's panel reads besides its conversation, written for Neon Realtime, so the panel reads each part again the moment its rows move rather than when a call's activity or end suggests they might have.
 *
 * Three parts, each a signal and none of their words: the board (`board`),
 * which moves as Luke draws and as a scene is saved; the pages agents
 * showed (`pages`), one row a page at its newest version; and the plan's
 * calls (`calls`), one row a call with how it ended, what it metered, and
 * how far its transcript reaches, which moves as a call's words land, as
 * it closes, and as its last words and its metering land after. The panel
 * reads the board, the pages, and the calls' transcript from the service
 * once their part moves. Each reads only a plan the account reaches, as
 * the held reads do; none reads the clock.
 */

/** The statements the open plan's record is followed by, each a part of the one read. */
export interface PlanRecordLiveStatements {
  readonly calls: LiveStatement;
  readonly board: LiveStatement;
  readonly pages: LiveStatement;
}

/** The plan's record written for Realtime; none where a statement names a value Realtime cannot carry. */
export function planRecordLiveStatements(
  userId: string,
  taskId: string,
): Option.Option<PlanRecordLiveStatements> {
  const reached = reachableTask(userId, taskId);
  const calls = queryBuilder
    .select({
      ...liveSelection(
        {
          id: voiceSessions.id,
          closeReason: voiceSessions.closeReason,
          model: voiceSessions.model,
          usage: voiceSessions.usage,
        },
        { closedAt: voiceSessions.closedAt },
      ),
      segments: LIVE_COUNT.as("segments"),
      lastSegment: sql<number>`coalesce(${max(voiceTranscriptSegments.seq)}, 0)::int`.as(
        "lastSegment",
      ),
    })
    .from(voiceSessions)
    .innerJoin(task, eq(task.id, voiceSessions.taskId))
    .leftJoin(
      voiceTranscriptSegments,
      eq(voiceTranscriptSegments.voiceSessionId, voiceSessions.id),
    )
    .where(reached)
    .groupBy(voiceSessions.id);
  const board = queryBuilder
    .select(
      liveSelection(
        {
          taskId: task.id,
          drawingNumber: taskBoard.drawingNumber,
          appliedDrawing: taskBoard.appliedDrawing,
        },
        { updatedAt: taskBoard.updatedAt },
      ),
    )
    .from(task)
    .leftJoin(taskBoard, eq(taskBoard.taskId, task.id))
    .where(reached);
  const pages = queryBuilder
    .select({
      ...liveSelection({ pageId: planPageVersion.pageId }),
      versions: LIVE_COUNT.as("versions"),
      newestAt: liveLatest(planPageVersion.at).as("newestAt"),
    })
    .from(planPageVersion)
    .innerJoin(task, eq(task.id, planPageVersion.taskId))
    .where(and(eq(planPageVersion.taskId, taskId), reached))
    .groupBy(planPageVersion.pageId);
  return Option.all({
    calls: liveStatementOf(calls),
    board: liveStatementOf(board),
    pages: liveStatementOf(pages),
  });
}
