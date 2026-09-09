import type { CarriedAction } from "../action-kinds.js";
import type { Refusal, ValidatedAction } from "../admit.js";

/**
 * An admitted action as the plain payload it carries. The brand is nominal and
 * carries no run-time field, so the one thing to drop is the origin admission
 * stamped, leaving a case free to say what was admitted without restating who
 * opened the turn.
 */
export function withoutAdmission(result: ValidatedAction | Refusal): CarriedAction | Refusal {
  if (result.kind === undefined) return result;
  const { origin, ...payload } = result;
  void origin;
  return payload;
}
