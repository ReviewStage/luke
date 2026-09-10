import type { ChildEnd } from "@sidecar/runtime";
import { CHILD_RUN_STATUS } from "@sidecar/runtime/vocabulary";
import { BRAIN_REQUEST_STATUS, type BrainRequestRecord } from "./requests.js";

/**
 * The end of a child run whose record its generation no longer holds — a
 * wait that returned nothing because the generation was replaced under it.
 * What the run did is unknown; nothing about it can be vouched for.
 */
export const RUN_FORGOTTEN: ChildEnd = {
  status: CHILD_RUN_STATUS.UNKNOWN,
  failureDetail: "the child's run was forgotten by its generation before it ended",
};

/** A child's run record as its requester's service reads its end. */
export function childRunEnd(record: BrainRequestRecord): ChildEnd {
  const counts = {
    performedActions: record.performedActions,
    unknownActions: record.unknownActions,
  };
  switch (record.status) {
    case BRAIN_REQUEST_STATUS.SUCCEEDED:
      return {
        status: CHILD_RUN_STATUS.COMPLETED,
        ...(record.text !== undefined ? { resultText: record.text } : undefined),
        ...counts,
      };
    case BRAIN_REQUEST_STATUS.CANCELLED:
      return { status: CHILD_RUN_STATUS.CANCELLED, ...counts };
    case BRAIN_REQUEST_STATUS.TIMED_OUT:
      return { status: CHILD_RUN_STATUS.TIMED_OUT, ...counts };
    case BRAIN_REQUEST_STATUS.INTERRUPTED:
      return {
        status: CHILD_RUN_STATUS.UNKNOWN,
        failureDetail:
          "the child's run was interrupted; what it did before is what its journal kept",
        ...counts,
      };
    case BRAIN_REQUEST_STATUS.FAILED:
      return {
        status: CHILD_RUN_STATUS.FAILED,
        ...(record.failure !== undefined ? { failureDetail: record.failure } : undefined),
        ...(record.text !== undefined ? { resultText: record.text } : undefined),
        ...counts,
      };
    case BRAIN_REQUEST_STATUS.QUEUED:
    case BRAIN_REQUEST_STATUS.RUNNING:
      return {
        status: CHILD_RUN_STATUS.UNKNOWN,
        failureDetail: "the child's run has not ended",
        ...counts,
      };
  }
}
