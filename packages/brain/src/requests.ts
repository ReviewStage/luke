import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

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
  /** A child's delegated task, handed to the child's own conversation by its requester's spawn. */
  CHILD: "child",
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
  /**
   * The context had to be compacted before the run could be sent and the
   * compaction did not succeed. The conversation stands exactly as it was;
   * the ask can be made again once the model or the network is back.
   */
  COMPACTION: "compaction",
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
  /** When the host recorded the ask itself in the thread, for an origin whose words the host records. */
  askRecordedAt?: number;
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
  if (value.askRecordedAt !== undefined && !finiteNumber(value.askRecordedAt)) return undefined;
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
  if (value.askRecordedAt !== undefined) record.askRecordedAt = value.askRecordedAt;
  if (value.startedAt !== undefined) record.startedAt = value.startedAt;
  if (value.settledAt !== undefined) record.settledAt = value.settledAt;
  if (value.text !== undefined) record.text = value.text;
  if (value.failure !== undefined) record.failure = value.failure;
  return record;
}

/** The record as the protocol carries it; `brainRequestRecordFromWire` reads it back whole. */
export function brainRequestRecordToWire(record: BrainRequestRecord): WireRecord {
  return {
    runId: record.runId,
    submissionId: record.submissionId,
    origin: record.origin,
    question: record.question,
    status: record.status,
    revision: record.revision,
    acceptedAt: record.acceptedAt,
    ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : undefined),
    ...(record.settledAt !== undefined ? { settledAt: record.settledAt } : undefined),
    ...(record.text !== undefined ? { text: record.text } : undefined),
    ...(record.failure !== undefined ? { failure: record.failure } : undefined),
    performedActs: record.performedActs,
    unknownActs: record.unknownActs,
    ...(record.askRecordedAt !== undefined ? { askRecordedAt: record.askRecordedAt } : undefined),
    ...(record.historyRecordedAt !== undefined
      ? { historyRecordedAt: record.historyRecordedAt }
      : undefined),
  };
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
  /** The generation holds as many records as it may, and none is yet eligible to be let go. */
  FULL: "full",
  /**
   * The generation's checkpoint was written by a runtime this build does not
   * run; it is kept whole, and nothing may open a turn over it until a
   * compatible runtime loads it or the developer starts fresh.
   */
  INCOMPATIBLE: "incompatible",
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

/**
 * What a submission's refusal says on the strip, in fixed words: never
 * composed with the ask, so a refusal can only ever be reported in these.
 */
export const BRAIN_ASK_REFUSAL = {
  [BRAIN_SUBMISSION_REJECTION.ABSENT]:
    "I can't reach my judgment right now: this build thinks only on an OpenAI key, and none is connected.",
  [BRAIN_SUBMISSION_REJECTION.EMPTY]: "I didn't catch an ask in that.",
  [BRAIN_SUBMISSION_REJECTION.PERSISTENCE]:
    "I couldn't write that ask down, so I haven't taken it. Ask me again in a moment.",
  [BRAIN_SUBMISSION_REJECTION.CONFLICT]:
    "That ask arrived under an id I already have for different words. Ask it afresh.",
  [BRAIN_SUBMISSION_REJECTION.FULL]:
    "My notes are full of asks whose endings I haven't managed to file yet. Give me a moment and ask again.",
  [BRAIN_SUBMISSION_REJECTION.INCOMPATIBLE]:
    "My memory was written by a different version of me, so I can't take that on until it's cleared or that version is back.",
} as const satisfies Record<BrainSubmissionRejection, string>;

/** What the voice says while a run is still going when its wait ran out. */
export const BRAIN_ASK_PENDING_NOTE = "I'm still working on that. I'll tell you when it's done.";

function actsPhrase(count: number): string {
  return count === 1 ? "one thing you asked" : `${count} things you asked`;
}

/**
 * What the record can vouch for about acts: what went through, and what was
 * dispatched but never answered — which may have happened, so it is said as
 * such and never retried on Luke's own initiative.
 */
function actsAccount(snapshot: BrainRequestRecord): string {
  const done = snapshot.performedActs;
  const unsure = snapshot.unknownActs;
  const parts: string[] = [];
  if (done > 0) parts.push(`I did ${actsPhrase(done)}`);
  if (unsure > 0) {
    parts.push(
      `${unsure === 1 ? "one act" : `${unsure} acts`} may have gone through without confirming, so I won't repeat ${unsure === 1 ? "it" : "them"} on my own`,
    );
  }
  return parts.join(", and ");
}

/**
 * The words a run's end leaves in the thread and in the voice's mouth, built
 * from the record alone. A reply the model reached is said as it stands; an
 * end without one is worded here in fixed sentences that say what was done
 * before it, so an act that went through is never reported as nothing having
 * happened, an act nobody confirmed is never reported as refused, and a reply
 * that failed to form is never reported as the acts failing. Nothing a model
 * or a provider wrote enters except the reply text.
 */
export function brainReplyWords(snapshot: BrainRequestRecord): string | undefined {
  const account = actsAccount(snapshot);
  const acted = account.length > 0;
  const said = snapshot.text ? `${snapshot.text} ` : "";
  switch (snapshot.status) {
    case BRAIN_REQUEST_STATUS.QUEUED:
    case BRAIN_REQUEST_STATUS.RUNNING:
      return undefined;
    case BRAIN_REQUEST_STATUS.SUCCEEDED:
      if (snapshot.text)
        return acted && snapshot.unknownActs > 0 ? `${said}${account}.` : snapshot.text;
      return acted ? `Done: ${account}.` : "I had nothing to add to that.";
    case BRAIN_REQUEST_STATUS.FAILED:
      if (snapshot.failure === BRAIN_REQUEST_FAILURE.PERSISTENCE) {
        return acted
          ? `${said}${account}, but I couldn't save my notes about it.`
          : `${said}I couldn't save my notes about that ask, so I stopped before doing anything.`;
      }
      if (snapshot.failure === BRAIN_REQUEST_FAILURE.INCOMPLETE) {
        return acted
          ? `${account}, but I ran out of room before finishing the reply.`
          : "I ran out of room before finishing that. Ask me again, perhaps in smaller pieces.";
      }
      return acted
        ? `${account}, but I couldn't put the reply into words.`
        : "I couldn't work that one out. Ask me again in a moment.";
    case BRAIN_REQUEST_STATUS.CANCELLED:
      return acted ? `Cancelled, though ${account}.` : "Cancelled.";
    case BRAIN_REQUEST_STATUS.TIMED_OUT:
      return acted ? `That ask ran out of time, though ${account}.` : "That ask ran out of time.";
    case BRAIN_REQUEST_STATUS.INTERRUPTED:
      return acted
        ? `That ask was interrupted, though ${account}.`
        : "That ask was interrupted before I could finish it.";
  }
}

/** Some fields of one record, as a save applies them over what is committed. */
export type RecordChanges = Partial<Omit<BrainRequestRecord, "runId" | "revision">>;

/** One record's fields over the committed record — or the record itself, for its own acceptance. */
export interface BrainRecordChange {
  runId: string;
  changes: RecordChanges;
  insert?: BrainRequestRecord;
}
