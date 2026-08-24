import { isRecord, isWireString, type UnparsedWireValue } from "./json.js";

export const ACT_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ActResultStatus = (typeof ACT_RESULT_STATUS)[keyof typeof ACT_RESULT_STATUS];

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
