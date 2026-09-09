import type { ChildEnd } from "@sidecar/runtime";
import {
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  type ChildSpawnReceipt,
  type ConversationRecord,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { BRAIN_REQUEST_STATUS, type BrainRequestRecord } from "./requests.js";

/**
 * The session tools' answers, in the records the model reads. Each is the
 * host's typed answer rendered here and nowhere else, so the wire shape a
 * conversation reads of its children is the brain's own.
 */

/** A spawn's receipt as the model reads it: accepted, never done, with the completion's route named. */
export function childSpawnReceiptRecord(receipt: ChildSpawnReceipt): WireRecord {
  return {
    status: ACT_RESULT_STATUS.ACCEPTED,
    accepted: true,
    completed: false,
    child_id: receipt.childId,
    child_session_key: receipt.childSessionKey,
    child_run_id: receipt.childRunId,
    ...(receipt.model ? { model: receipt.model } : undefined),
    context: receipt.context,
    ...(receipt.contextNote ? { context_note: receipt.contextNote } : undefined),
    depth: receipt.depth,
    completion:
      "arrives in this conversation as its own item when the child ends; do not poll for it",
  };
}

/** One child as `subagents` lists it: its record's standing and, once it has one, its completion's delivery. */
export function childSummaryRecord(
  record: ChildRunRecord,
  completion: ChildCompletionRecord | undefined,
): WireRecord {
  return {
    child_id: record.childId,
    ...(record.label !== undefined ? { label: record.label } : undefined),
    status: record.status,
    depth: record.depth,
    context: record.context,
    accepted_at: new Date(record.acceptedAt).toISOString(),
    ...(record.settledAt !== undefined
      ? { settled_at: new Date(record.settledAt).toISOString() }
      : undefined),
    ...(record.resultText !== undefined ? { has_result: true } : undefined),
    ...(completion ? { delivery: completion.delivery, attempts: completion.attempts } : undefined),
  };
}

/** The unarchived conversations as `sessions_list` answers them, the asking one marked current. */
export function conversationListingRecord(
  directory: readonly ConversationRecord[],
  current: SessionKey,
): WireRecord {
  return {
    status: ACT_RESULT_STATUS.ACCEPTED,
    conversations: directory
      .filter((record) => record.archivedAt === undefined)
      .map((record) => ({
        session_key: record.sessionKey,
        kind: record.kind,
        name: record.name,
        last_activity_at: new Date(record.lastActivityAt).toISOString(),
        ...(record.sessionKey === current ? { current: true } : undefined),
      })),
  };
}

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
  const counts = { performedActs: record.performedActs, unknownActs: record.unknownActs };
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
