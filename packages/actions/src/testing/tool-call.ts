import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "@sidecar/wire";
import type { RealtimeFunctionCall } from "../action-kinds.js";
import { ACTIONS } from "../actions.js";
import {
  ACTION_REFUSAL,
  type AdmitContext,
  admit,
  type Refusal,
  type ValidatedAction,
} from "../admit.js";

/**
 * One model-emitted tool call admitted the way a tool module admits it: the
 * name selects the action, the arguments are read as that action's own
 * fields, and `admit` is the whole of validation. For tests that speak in
 * calls; the build's own modules parse their arguments before `admit` sees
 * them and never take a call.
 */
export async function admitToolCall(
  call: RealtimeFunctionCall,
  context: AdmitContext,
): Promise<ValidatedAction | Refusal> {
  const spec = Object.values(ACTIONS).find((candidate) => candidate.name === call.name);
  if (!spec) return { status: ACTION_RESULT_STATUS.REJECTED, reason: ACTION_REFUSAL.NO_TOOL };
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse answers a wire value; the record check is the validation.
    parsed = JSON.parse(call.argumentsJson) as UnparsedWireValue;
  } catch {
    return { status: ACTION_RESULT_STATUS.REJECTED, reason: ACTION_REFUSAL.UNREADABLE };
  }
  if (!isRecord(parsed)) {
    return { status: ACTION_RESULT_STATUS.REJECTED, reason: ACTION_REFUSAL.UNREADABLE };
  }
  return admit({ kind: spec.kind, fields: parsed }, context);
}
