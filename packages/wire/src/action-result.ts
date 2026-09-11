import { isRecord, isWireString, type UnparsedWireValue } from "./json.js";

export const ACTION_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ActionResultStatus = (typeof ACTION_RESULT_STATUS)[keyof typeof ACTION_RESULT_STATUS];

/**
 * The one sentence an adapter answers an action its target's latest observation
 * did not advertise. It is written once because it is one refusal: the latest
 * read is what says which acts a provider documents for a session or an issue
 * now, and an action that outran that read is refused the same way whoever was
 * asked.
 */
export const UNSUPPORTED_BY_OBSERVATION = "That action is not supported by the latest observation.";

const ACTION_RESULT_STATUSES: ReadonlySet<string> = new Set(Object.values(ACTION_RESULT_STATUS));

/** Whether an untrusted value names one of the three statuses an action can end in. */
export function isActionResultStatus(value: UnparsedWireValue): value is ActionResultStatus {
  return isWireString(value) && ACTION_RESULT_STATUSES.has(value);
}

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

export type ActionResult =
  | { status: typeof ACTION_RESULT_STATUS.ACCEPTED }
  | { status: typeof ACTION_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACTION_RESULT_STATUS.UNSUPPORTED; reason: string };

export function isActionResult(value: UnparsedWireValue): value is ActionResult {
  if (!isRecord(value) || !isActionResultStatus(value.status)) return false;
  const fieldCount = Object.keys(value).length;
  if (value.status === ACTION_RESULT_STATUS.ACCEPTED) return fieldCount === 1;
  return (
    fieldCount === 2 &&
    (value.status === ACTION_RESULT_STATUS.REJECTED ||
      value.status === ACTION_RESULT_STATUS.UNSUPPORTED) &&
    isWireString(value.reason)
  );
}
