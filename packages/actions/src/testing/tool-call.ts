import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { Effect } from "effect";
import type { ActionFunctionCall } from "../action-kinds.js";
import { ACTIONS } from "../actions.js";
import {
  ACTION_REFUSAL,
  type AdmitContext,
  admitEffect,
  type Refusal,
  type ValidatedAction,
} from "../admit.js";

/**
 * One model-emitted tool call admitted the way a tool module admits it: the
 * name selects the action, the arguments are read as that action's own
 * fields, and `admitEffect` is the whole of validation. For tests that speak
 * in calls; the build's own modules parse their arguments before admission
 * sees them and never take a call.
 *
 * The decision is the effect's success either way, since a call this door
 * could not read is refused before the gauntlet runs and a case reads both
 * refusals the same. A roster read that fails is still the defect it is
 * inside `admitEffect`.
 */
export function admitToolCall(
  call: ActionFunctionCall,
  context: AdmitContext,
): Effect.Effect<ValidatedAction | Refusal> {
  return Effect.suspend(() => {
    const spec = Object.values(ACTIONS).find((candidate) => candidate.name === call.name);
    if (!spec) return Effect.succeed(refused(ACTION_REFUSAL.NO_TOOL));
    let parsed: UnparsedWireValue;
    try {
      // SAFETY: JSON.parse answers a wire value; the record check is the validation.
      parsed = JSON.parse(call.argumentsJson) as UnparsedWireValue;
    } catch {
      return Effect.succeed(refused(ACTION_REFUSAL.UNREADABLE));
    }
    if (!isRecord(parsed)) return Effect.succeed(refused(ACTION_REFUSAL.UNREADABLE));
    return Effect.catchAll(admitEffect({ kind: spec.kind, fields: parsed }, context), (refusal) =>
      Effect.succeed(refused(refusal.reason)),
    );
  });
}

function refused(reason: string): Refusal {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}
