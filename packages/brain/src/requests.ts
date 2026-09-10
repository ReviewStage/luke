import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestFailure,
  type BrainRequestOrigin,
  type BrainRequestStatus,
  type BrainSubmissionRejection,
  isBrainRequestOrigin,
} from "@sidecar/hosted";
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
 * than resuming an action it cannot know the state of.
 */

export {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestFailure,
  type BrainRequestOrigin,
  type BrainRequestStatus,
  type BrainSubmissionRejection,
  isBrainRequestOrigin,
};

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
  /** How many actions the run performed to completion, so a failed reply still says what was done. */
  performedActions: number;
  /**
   * How many actions were dispatched whose result never came back: a performer
   * that threw after the provider may have accepted the write, or a launch
   * that found the action started and its result unrecorded. Each may have
   * happened, so none is retried and the developer is told as much.
   */
  unknownActions: number;
  /** When the host recorded the ask itself in the thread, for an origin whose words the host records. */
  askRecordedAt?: number;
  /** When the host recorded the run's end in the thread, so it is recorded exactly once. */
  conversationRecordedAt?: number;
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
  if (!finiteNumber(value.performedActions) || !finiteNumber(value.unknownActions))
    return undefined;
  if (value.conversationRecordedAt !== undefined && !finiteNumber(value.conversationRecordedAt)) {
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
    performedActions: value.performedActions,
    unknownActions: value.unknownActions,
  };
  if (value.conversationRecordedAt !== undefined)
    record.conversationRecordedAt = value.conversationRecordedAt;
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
    performedActions: record.performedActions,
    unknownActions: record.unknownActions,
    ...(record.askRecordedAt !== undefined ? { askRecordedAt: record.askRecordedAt } : undefined),
    ...(record.conversationRecordedAt !== undefined
      ? { conversationRecordedAt: record.conversationRecordedAt }
      : undefined),
  };
}

function finiteNumber(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0;
}

/**
 * What a launch does to the records the last one left unfinished: nothing it
 * was doing is resumed, because an action mid-flight when the process died is
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

/** What the voice says of a spoken ask the developer stopped before its reply formed. */
export const BRAIN_ASK_STOPPED_NOTE = "That ask was stopped before I finished it.";

function actionsPhrase(count: number): string {
  return count === 1 ? "one thing you asked" : `${count} things you asked`;
}

/**
 * What the record can vouch for about actions: what went through, and what was
 * dispatched but never answered — which may have happened, so it is said as
 * such and never retried on Luke's own initiative.
 */
function actionsAccount(snapshot: BrainRequestRecord): string {
  const done = snapshot.performedActions;
  const unsure = snapshot.unknownActions;
  const parts: string[] = [];
  if (done > 0) parts.push(`I did ${actionsPhrase(done)}`);
  if (unsure > 0) {
    parts.push(
      `${unsure === 1 ? "one action" : `${unsure} actions`} may have gone through without confirming, so I won't repeat ${unsure === 1 ? "it" : "them"} on my own`,
    );
  }
  return parts.join(", and ");
}

/**
 * The words a run's end leaves in the thread and in the voice's mouth, built
 * from the record alone. A reply the model reached is said as it stands; an
 * end without one is worded here in fixed sentences that say what was done
 * before it, so an action that went through is never reported as nothing having
 * happened, an action nobody confirmed is never reported as refused, and a reply
 * that failed to form is never reported as the actions failing. Nothing a model
 * or a provider wrote enters except the reply text.
 */
export function brainReplyWords(snapshot: BrainRequestRecord): string | undefined {
  const account = actionsAccount(snapshot);
  const acted = account.length > 0;
  const said = snapshot.text ? `${snapshot.text} ` : "";
  switch (snapshot.status) {
    case BRAIN_REQUEST_STATUS.QUEUED:
    case BRAIN_REQUEST_STATUS.RUNNING:
      return undefined;
    case BRAIN_REQUEST_STATUS.SUCCEEDED:
      if (snapshot.text)
        return acted && snapshot.unknownActions > 0 ? `${said}${account}.` : snapshot.text;
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
      // A plain stop is the developer's own press, not a reply: it reaches the
      // thread as the quiet line `stoppedAskNarration` words and is never
      // offered to the ear. What was done before the stop is still news, so
      // that account is said.
      return acted ? `Cancelled, though ${account}.` : undefined;
    case BRAIN_REQUEST_STATUS.TIMED_OUT:
      return acted ? `That ask ran out of time, though ${account}.` : "That ask ran out of time.";
    case BRAIN_REQUEST_STATUS.INTERRUPTED:
      return acted
        ? `That ask was interrupted, though ${account}.`
        : "That ask was interrupted before I could finish it.";
  }
}

/** What a stopped ask leaves in the thread, in the voice of the actions carried at the developer's ask. */
export const STOPPED_ASK_NARRATION = "stopped working on that ask";

/**
 * The quiet line a run the developer stopped leaves behind, worded as what
 * Luke did at their ask rather than as something he said, so it is drawn in the
 * thread's event voice and never spoken. A cancel that had already acted is
 * not quiet: its account travels as the reply `brainReplyWords` builds.
 */
export function stoppedAskNarration(snapshot: BrainRequestRecord): string | undefined {
  if (snapshot.status !== BRAIN_REQUEST_STATUS.CANCELLED) return undefined;
  return actionsAccount(snapshot).length > 0 ? undefined : STOPPED_ASK_NARRATION;
}

/** Some fields of one record, as a save applies them over what is committed. */
export type RecordChanges = Partial<Omit<BrainRequestRecord, "runId" | "revision">>;

/** One record's fields over the committed record — or the record itself, for its own acceptance. */
export interface BrainRecordChange {
  runId: string;
  changes: RecordChanges;
  insert?: BrainRequestRecord;
}
