import { Schema } from "effect";
import type { UnparsedWireValue } from "./json.js";

export const ACTION_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ActionResultStatus = (typeof ACTION_RESULT_STATUS)[keyof typeof ACTION_RESULT_STATUS];

export const ActionResultStatusSchema = Schema.Literal(...Object.values(ACTION_RESULT_STATUS));

const readsActionResultStatus = Schema.is(ActionResultStatusSchema);

/** Whether an untrusted value names one of the three statuses an action can end in. */
export function isActionResultStatus(value: UnparsedWireValue): value is ActionResultStatus {
  return readsActionResultStatus(value);
}

/**
 * The one sentence an adapter answers an action its target's latest observation
 * did not advertise. It is written once because it is one refusal: the latest
 * read is what says which acts a provider documents for a session or an issue
 * now, and an action that outran that read is refused the same way whoever was
 * asked.
 */
export const UNSUPPORTED_BY_OBSERVATION = "That action is not supported by the latest observation.";

/**
 * The one status outside the three above an action can end in: dispatched, and
 * its answer lost before it was recorded. It is neither a refusal nor a
 * result; the effect may have happened, so nothing that reads it may retry
 * the action on its own or report it as failed.
 */
export const UNKNOWN_ACTION_STATUS = "unknown";

export type UnknownActionResult = {
  readonly status: typeof UNKNOWN_ACTION_STATUS;
  readonly reason: string;
};

/** A record whose keys stop at the ones its fields name, the way a strict wire record does. */
const strict = { parseOptions: { onExcessProperty: "error" as const } };

const ACCEPTED_ACTION_RESULT = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
}).annotations(strict);

const REJECTED_ACTION_RESULT = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.REJECTED),
  reason: Schema.String,
}).annotations(strict);

const UNSUPPORTED_ACTION_RESULT = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.UNSUPPORTED),
  reason: Schema.String,
}).annotations(strict);

export const ActionResultSchema = Schema.Union(
  ACCEPTED_ACTION_RESULT,
  REJECTED_ACTION_RESULT,
  UNSUPPORTED_ACTION_RESULT,
);

export type ActionResult = Schema.Schema.Type<typeof ActionResultSchema>;

const readsActionResult = Schema.is(ActionResultSchema);

export function isActionResult(value: UnparsedWireValue): value is ActionResult {
  return readsActionResult(value);
}
