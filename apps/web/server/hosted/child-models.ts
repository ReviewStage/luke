/**
 * child-models.ts -- the model a planning worker's newest task ran on, read off the turn row its journal was written under.
 *
 * A worker's turns are recorded in its child conversation as the planning
 * model's are in the plan's, each turn row naming the model eve resolved it
 * to, so the Work tab names the worker's model from that record, the way an
 * agent's subagent row names the pair its delegation chose. A leaf over the
 * store alone, read by the plan's work read back and by the live follow.
 */

import { CATALOG_ID_SEPARATOR } from "@sidecar/hosted/model-label";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { Effect } from "effect";
import type { SubagentJournal } from "../voice/plan-work.js";
import { turnsNamed } from "./store/message-reads.js";

/**
 * A recorded model as the catalog names it. Note that the brain reaches
 * OpenAI directly (`brain-host/model.ts`), so its turn rows record OpenAI's
 * own id, which the catalog names under its provider; an id that already
 * names one is kept.
 */
function catalogIdOf(model: string): string {
  return model.includes(CATALOG_ID_SEPARATOR)
    ? model
    : `${MODEL_PROVIDER.OPENAI}${CATALOG_ID_SEPARATOR}${model}`;
}

/** The catalog id of the model each subagent's newest task ran on, by the call its session is read under; none where its turn row records none. */
export function subagentModelsByCall(
  userId: string,
  subagents: ReadonlyMap<string, readonly SubagentJournal[]>,
) {
  const newest = new Map<string, string>();
  for (const [callId, journals] of subagents) {
    const turnId = journals.at(-1)?.turnId;
    if (turnId !== undefined) newest.set(callId, turnId);
  }
  return Effect.map(turnsNamed(userId, [...new Set(newest.values())]), (turns) => {
    const models = new Map(turns.map((turn) => [turn.id, turn.model]));
    const byCall = new Map<string, string>();
    for (const [callId, turnId] of newest) {
      const model = models.get(turnId);
      if (model) byCall.set(callId, catalogIdOf(model));
    }
    return byCall;
  });
}
