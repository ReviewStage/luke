import type { CarriedAct } from "../act-kinds.js";
import type { Refusal, ValidatedAct } from "../admit.js";

/**
 * An admitted act as the plain payload it carries: the brand a deep equality
 * would report and the origin admission stamped are both dropped, so a case
 * can compare what was admitted against what a validator that knew neither
 * answered.
 */
export function withoutAdmission(result: ValidatedAct | Refusal): CarriedAct | Refusal {
  if (result.kind === undefined) return result;
  const { origin, ...payload } = result;
  void origin;
  for (const key of Object.getOwnPropertySymbols(payload)) {
    Reflect.deleteProperty(payload, key);
  }
  return payload;
}
