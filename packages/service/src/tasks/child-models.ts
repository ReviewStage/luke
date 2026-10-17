/**
 * child-models.ts -- what a brain worker's newest task ran on and spent, read off the turn row its journal was written under.
 *
 * A worker's turns are recorded in its child conversation as the brain's
 * are in the task's, each turn row naming the model eve resolved it
 * to and, once it settles, its tokens and how it ended, so the Work tab
 * names the worker's model from that record, the way an agent's subagent
 * row names the pair its delegation chose, and its tab's footer card says
 * the rest (`turn-record.ts`). A leaf over the store alone, read by the
 * task's work read back and by the live follow.
 */

import { turnsNamed } from "@luke/database/models/message-reads";
import type { TurnRecord } from "@luke/features/coding-agent-wire";
import { Effect } from "effect";
import { turnRecordOf } from "../agents/turn-record.js";
import type { SubagentJournal } from "./task-work.js";

/** What each subagent's newest task ran on and spent, by the call its session is read under; none where its journal names no turn row. */
export function subagentRecordsByCall(
  userId: string,
  subagents: ReadonlyMap<string, readonly SubagentJournal[]>,
) {
  const newest = new Map<string, string>();
  for (const [callId, journals] of subagents) {
    const turnId = journals.at(-1)?.turnId;
    if (turnId !== undefined) newest.set(callId, turnId);
  }
  return Effect.map(turnsNamed(userId, [...new Set(newest.values())]), (turns) => {
    const records = new Map(turns.map((turn) => [turn.id, turnRecordOf(turn)]));
    const byCall = new Map<string, TurnRecord>();
    for (const [callId, turnId] of newest) {
      const record = records.get(turnId);
      if (record !== undefined) byCall.set(callId, record);
    }
    return byCall;
  });
}
