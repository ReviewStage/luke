import { isRecord, isWireString, type UnparsedWireValue } from "./json.js";

export const ACT_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ActResultStatus = (typeof ACT_RESULT_STATUS)[keyof typeof ACT_RESULT_STATUS];

/**
 * The one status outside the three above an act can end in: dispatched, and
 * its answer lost before it was recorded. It is neither a refusal nor a
 * result; the effect may have happened, so nothing that reads it may retry
 * the act on its own or report it as failed.
 */
export const UNKNOWN_ACT_STATUS = "unknown";

export type UnknownActResult = { status: typeof UNKNOWN_ACT_STATUS; reason: string };

export function isUnknownActResult(value: UnparsedWireValue): value is UnknownActResult {
  return isRecord(value) && value.status === UNKNOWN_ACT_STATUS && isWireString(value.reason);
}

export type ActResult =
  | { status: typeof ACT_RESULT_STATUS.ACCEPTED }
  | { status: typeof ACT_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACT_RESULT_STATUS.UNSUPPORTED; reason: string };

export function isActResult(value: UnparsedWireValue): value is ActResult {
  if (!isRecord(value) || !isWireString(value.status)) return false;
  const fieldCount = Object.keys(value).length;
  if (value.status === ACT_RESULT_STATUS.ACCEPTED) return fieldCount === 1;
  return (
    fieldCount === 2 &&
    (value.status === ACT_RESULT_STATUS.REJECTED ||
      value.status === ACT_RESULT_STATUS.UNSUPPORTED) &&
    isWireString(value.reason)
  );
}
