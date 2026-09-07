import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * A developer ask as the brain owns it from acceptance to its end. The record
 * outlives the call that asked, the renderer that showed it, and the launch
 * that ran it: a submission is acknowledged only once its record is on disk,
 * a wait answers with the record as it stands rather than abandoning the run,
 * and a restart finds every unfinished record and marks it interrupted rather
 * than resuming an act it cannot know the state of.
 */

export const BRAIN_REQUEST_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  TIMED_OUT: "timed_out",
  INTERRUPTED: "interrupted",
} as const;

export type BrainRequestStatus = (typeof BRAIN_REQUEST_STATUS)[keyof typeof BRAIN_REQUEST_STATUS];

const BRAIN_REQUEST_STATUS_LIST: readonly BrainRequestStatus[] =
  Object.values(BRAIN_REQUEST_STATUS);

export const BRAIN_REQUEST_TERMINAL_STATUS: ReadonlySet<BrainRequestStatus> = new Set([
  BRAIN_REQUEST_STATUS.SUCCEEDED,
  BRAIN_REQUEST_STATUS.FAILED,
  BRAIN_REQUEST_STATUS.CANCELLED,
  BRAIN_REQUEST_STATUS.TIMED_OUT,
  BRAIN_REQUEST_STATUS.INTERRUPTED,
]);

export function isBrainRequestStatus(value: UnparsedWireValue): value is BrainRequestStatus {
  return (
    isWireString(value) &&
    // SAFETY: value is a string; list membership is the vocabulary check.
    BRAIN_REQUEST_STATUS_LIST.includes(value as BrainRequestStatus)
  );
}

export function isTerminalBrainRequestStatus(status: BrainRequestStatus): boolean {
  return BRAIN_REQUEST_TERMINAL_STATUS.has(status);
}

/** Where the ask came from, which decides who records its words in the thread. */
export const BRAIN_REQUEST_ORIGIN = {
  /** Typed into a composer; the words travel with the submission and the host records them. */
  TYPED: "typed",
  /** Spoken; the voice service's own transcript is the record, and the question here is the mouth's relay. */
  SPOKEN: "spoken",
} as const;

export type BrainRequestOrigin = (typeof BRAIN_REQUEST_ORIGIN)[keyof typeof BRAIN_REQUEST_ORIGIN];

const BRAIN_REQUEST_ORIGIN_LIST: readonly BrainRequestOrigin[] =
  Object.values(BRAIN_REQUEST_ORIGIN);

export function isBrainRequestOrigin(value: UnparsedWireValue): value is BrainRequestOrigin {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && BRAIN_REQUEST_ORIGIN_LIST.includes(value as BrainRequestOrigin);
}

/**
 * Why a run ended without a reply, as a fixed word rather than a provider's
 * sentence: the host words each one for the thread, so no raw model or
 * network output reaches the developer's record.
 */
export const BRAIN_REQUEST_FAILURE = {
  /** The model did not answer, or answered nothing readable. */
  MODEL: "model",
  /** A checkpoint could not be written, so the run stopped before or after an act. */
  PERSISTENCE: "persistence",
  /** The run reached its execution deadline. */
  DEADLINE: "deadline",
  /** The model stopped before a reply formed: an incomplete output, or the tool budget spent. */
  INCOMPLETE: "incomplete",
} as const;

export type BrainRequestFailure =
  (typeof BRAIN_REQUEST_FAILURE)[keyof typeof BRAIN_REQUEST_FAILURE];

const BRAIN_REQUEST_FAILURE_LIST: readonly BrainRequestFailure[] =
  Object.values(BRAIN_REQUEST_FAILURE);

export function isBrainRequestFailure(value: UnparsedWireValue): value is BrainRequestFailure {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && BRAIN_REQUEST_FAILURE_LIST.includes(value as BrainRequestFailure);
}

export interface BrainRequestRecord {
  /** The run's own id, minted by the brain at acceptance. */
  runId: string;
  /** The caller's id for one deliberate submission; a retry of the same submission finds the same run. */
  submissionId: string;
  origin: BrainRequestOrigin;
  /** The ask as the brain was handed it, bounded by the host. */
  question: string;
  status: BrainRequestStatus;
  /** Bumped on every change, so two snapshots of one run can be ordered without a clock. */
  revision: number;
  acceptedAt: number;
  startedAt?: number;
  settledAt?: number;
  /** The reply, when the run reached one. */
  text?: string;
  failure?: BrainRequestFailure;
  /** How many acts the run performed to completion, so a failed reply still says what was done. */
  performedActs: number;
  /**
   * How many acts were dispatched whose result never came back: a performer
   * that threw after the provider may have accepted the write, or a launch
   * that found the act started and its result unrecorded. Each may have
   * happened, so none is retried and the developer is told as much.
   */
  unknownActs: number;
  /** When the host recorded the run's end in the thread, so it is recorded exactly once. */
  historyRecordedAt?: number;
}

/** Reads a stored record, or nothing for one this build cannot vouch for. */
export function brainRequestRecordFromWire(
  value: UnparsedWireValue,
): BrainRequestRecord | undefined {
  if (!isRecord(value)) return undefined;
  const runId = isWireString(value.runId) && value.runId.length > 0 ? value.runId : undefined;
  const submissionId =
    isWireString(value.submissionId) && value.submissionId.length > 0
      ? value.submissionId
      : undefined;
  if (!runId || !submissionId) return undefined;
  if (!isBrainRequestOrigin(value.origin) || !isBrainRequestStatus(value.status)) return undefined;
  if (!isWireString(value.question)) return undefined;
  if (!finiteNumber(value.acceptedAt) || !finiteNumber(value.revision)) return undefined;
  if (!finiteNumber(value.performedActs) || !finiteNumber(value.unknownActs)) return undefined;
  if (value.historyRecordedAt !== undefined && !finiteNumber(value.historyRecordedAt)) {
    return undefined;
  }
  if (value.startedAt !== undefined && !finiteNumber(value.startedAt)) return undefined;
  if (value.settledAt !== undefined && !finiteNumber(value.settledAt)) return undefined;
  if (value.text !== undefined && !isWireString(value.text)) return undefined;
  if (value.failure !== undefined && !isBrainRequestFailure(value.failure)) return undefined;
  const record: BrainRequestRecord = {
    runId,
    submissionId,
    origin: value.origin,
    question: value.question,
    status: value.status,
    revision: value.revision,
    acceptedAt: value.acceptedAt,
    performedActs: value.performedActs,
    unknownActs: value.unknownActs,
  };
  if (value.historyRecordedAt !== undefined) record.historyRecordedAt = value.historyRecordedAt;
  if (value.startedAt !== undefined) record.startedAt = value.startedAt;
  if (value.settledAt !== undefined) record.settledAt = value.settledAt;
  if (value.text !== undefined) record.text = value.text;
  if (value.failure !== undefined) record.failure = value.failure;
  return record;
}

function finiteNumber(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0;
}

/**
 * What a launch does to the records the last one left unfinished: nothing it
 * was doing is resumed, because an act mid-flight when the process died is
 * one whose effect it cannot know, and a queued ask is answered with the
 * honest interruption rather than run against a roster the developer has not
 * looked at since.
 */
export function interruptedUnfinishedRequests(
  records: readonly BrainRequestRecord[],
  now: number,
): readonly BrainRequestRecord[] {
  if (records.every((record) => isTerminalBrainRequestStatus(record.status))) return records;
  return records.map((record) =>
    isTerminalBrainRequestStatus(record.status)
      ? record
      : {
          ...record,
          status: BRAIN_REQUEST_STATUS.INTERRUPTED,
          revision: record.revision + 1,
          settledAt: now,
        },
  );
}

/**
 * The answer to a submission. Accepted names the run — the same run for a
 * retry of the same submission — and rejected says why in a word the host
 * words for the developer.
 */
export const BRAIN_SUBMISSION_REJECTION = {
  EMPTY: "empty",
  ABSENT: "absent",
  PERSISTENCE: "persistence",
  /** The submission id is already taken by an ask with other words or another origin. */
  CONFLICT: "conflict",
} as const;

export type BrainSubmissionRejection =
  (typeof BRAIN_SUBMISSION_REJECTION)[keyof typeof BRAIN_SUBMISSION_REJECTION];

export const BRAIN_SUBMISSION_OUTCOME = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
} as const;

export type BrainSubmissionResult =
  | { outcome: typeof BRAIN_SUBMISSION_OUTCOME.ACCEPTED; runId: string; acceptedAt: number }
  | { outcome: typeof BRAIN_SUBMISSION_OUTCOME.REJECTED; reason: BrainSubmissionRejection };

export interface BrainSubmission {
  submissionId: string;
  question: string;
  origin: BrainRequestOrigin;
}
