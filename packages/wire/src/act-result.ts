import { isRecord, isWireString, type UnparsedWireValue } from "./json.js";

export const ACT_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ActResultStatus = (typeof ACT_RESULT_STATUS)[keyof typeof ACT_RESULT_STATUS];

/**
 * The one sentence an adapter answers an act its target's latest observation
 * did not advertise. It is written once because it is one refusal: the latest
 * read is what says which acts a provider documents for a session or an issue
 * now, and an act that outran that read is refused the same way whoever was
 * asked.
 */
export const UNSUPPORTED_BY_OBSERVATION = "That act is not supported by the latest observation.";

const ACT_RESULT_STATUSES: ReadonlySet<string> = new Set(Object.values(ACT_RESULT_STATUS));

/** Whether an untrusted value names one of the three statuses an act can end in. */
export function isActResultStatus(value: UnparsedWireValue): value is ActResultStatus {
  return isWireString(value) && ACT_RESULT_STATUSES.has(value);
}

/**
 * The one status outside the three above an act can end in: dispatched, and
 * its answer lost before it was recorded. It is neither a refusal nor a
 * result; the effect may have happened, so nothing that reads it may retry
 * the act on its own or report it as failed.
 */
export const UNKNOWN_ACT_STATUS = "unknown";

export type UnknownActResult = { status: typeof UNKNOWN_ACT_STATUS; reason: string };

export type ActResult =
  | { status: typeof ACT_RESULT_STATUS.ACCEPTED }
  | { status: typeof ACT_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACT_RESULT_STATUS.UNSUPPORTED; reason: string };

export function isActResult(value: UnparsedWireValue): value is ActResult {
  if (!isRecord(value) || !isActResultStatus(value.status)) return false;
  const fieldCount = Object.keys(value).length;
  if (value.status === ACT_RESULT_STATUS.ACCEPTED) return fieldCount === 1;
  return (
    fieldCount === 2 &&
    (value.status === ACT_RESULT_STATUS.REJECTED ||
      value.status === ACT_RESULT_STATUS.UNSUPPORTED) &&
    isWireString(value.reason)
  );
}
