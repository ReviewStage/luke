import type { CarriedAppAct } from "@sidecar/acts";
import {
  type BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestOrigin,
  type BrainRequestRecord,
  type BrainSubmissionRejection,
  brainRequestRecordFromWire,
  isBrainRequestOrigin,
} from "@sidecar/brain/requests";
import { maximumTypedAskLength } from "@sidecar/realtime";
import {
  type ACT_RESULT_STATUS,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

/**
 * What crosses the bridge between the brain in the main process and the
 * windows. The brain decides and acts on its own side; what reaches a
 * renderer is the record of a run it submitted or is drawing, and the few app
 * acts only a renderer can perform. A briefing travels as a speech offer
 * instead, from the speech arbiter that decides when it may be said.
 */

/** One deliberate ask, as a renderer submits it: minted once per submission, so a retry finds the same run. */
export interface BrainAskSubmission {
  submissionId: string;
  question: string;
  origin: (typeof BRAIN_REQUEST_ORIGIN)[keyof typeof BRAIN_REQUEST_ORIGIN];
}

export function isBrainAskSubmission(value: UnparsedWireValue): boolean {
  return (
    isRecord(value) &&
    isWireString(value.submissionId) &&
    value.submissionId.length > 0 &&
    isWireString(value.question) &&
    value.question.length <= maximumTypedAskLength &&
    isBrainRequestOrigin(value.origin)
  );
}

/** The answer to a submission, as the bridge carries the brain's own result. */
export type BrainAskSubmissionResult =
  | { outcome: typeof BRAIN_SUBMISSION_OUTCOME.ACCEPTED; runId: string; acceptedAt: number }
  | { outcome: typeof BRAIN_SUBMISSION_OUTCOME.REJECTED; reason: BrainSubmissionRejection };

export function isBrainAskSubmissionResult(
  value: UnparsedWireValue,
): value is BrainAskSubmissionResult {
  if (!isRecord(value)) return false;
  if (value.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
    return isWireString(value.runId) && isWireNumber(value.acceptedAt);
  }
  return (
    value.outcome === BRAIN_SUBMISSION_OUTCOME.REJECTED &&
    Object.values(BRAIN_SUBMISSION_REJECTION).some((reason) => reason === value.reason)
  );
}

/** A run's record as a renderer draws it: the brain's own record, unchanged. */
export type BrainRequestSnapshot = BrainRequestRecord;

export function isBrainRequestSnapshot(value: UnparsedWireValue): boolean {
  return brainRequestRecordFromWire(value) !== undefined;
}

export function isBrainRequestSnapshotList(value: UnparsedWireValue): boolean {
  return Array.isArray(value) && value.every(isBrainRequestSnapshot);
}

/** A run the renderer may still cancel: accepted, not yet ended. */
export function brainRequestPending(snapshot: BrainRequestSnapshot): boolean {
  return (
    snapshot.status === BRAIN_REQUEST_STATUS.QUEUED ||
    snapshot.status === BRAIN_REQUEST_STATUS.RUNNING
  );
}

/** The tool output's status when the run is still going: neither an answer nor a refusal. */
export const BRAIN_ASK_PENDING_STATUS = "pending";

/**
 * What the voice's `ask_brain` tool comes back with: the reply for the voice
 * to say, the honest note that the run is still going, or a bounded refusal
 * the voice can say instead.
 */
export type BrainAskResult =
  | { status: typeof ACT_RESULT_STATUS.ACCEPTED; briefing: string; runId: string }
  | { status: typeof BRAIN_ASK_PENDING_STATUS; note: string }
  | { status: typeof ACT_RESULT_STATUS.REJECTED; reason: string };

/**
 * One ended run whose reply the main process offers the voice window to
 * speak. The words do not travel with the offer: the window claims the
 * delivery first, and the grant carries them, read from the live record at
 * that moment so a run the store has since let go of is never spoken.
 */
export interface BrainReplyOffer {
  runId: string;
  deliveryId: string;
  /** The receiver epoch the offer went to; the claim and the acknowledgement name it back. */
  epoch: number;
}

export function isReceiverEpoch(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isInteger(value) && value >= 0;
}

export function isBrainReplyOffer(value: UnparsedWireValue): value is BrainReplyOffer & WireRecord {
  return (
    isRecord(value) &&
    isWireString(value.runId) &&
    value.runId.length > 0 &&
    isWireString(value.deliveryId) &&
    value.deliveryId.length > 0 &&
    isReceiverEpoch(value.epoch)
  );
}

/**
 * What a wait on a spoken ask comes back with: the record as it then stands,
 * or nothing for a run the brain does not know, and whether the call that
 * asked has been granted the words. `speak` is true only for an ended run
 * whose end already stands in History and whose one grant this wait took; a
 * run still going, or one whose words another path holds, is not the
 * call's to say.
 */
export interface BrainAskWait {
  record: BrainRequestSnapshot | undefined;
  speak: boolean;
}

export function isBrainAskWait(value: UnparsedWireValue): boolean {
  return (
    isRecord(value) &&
    (value.record === undefined || isBrainRequestSnapshot(value.record)) &&
    isWireBoolean(value.speak)
  );
}

/** The main process's answer to a claim: the words to say, once, or nothing. */
/**
 * The main process's answer to a claim: the words to say, once, with the
 * origin of the ask they answer — a typed ask's reply holds the composer's
 * caption, a spoken one's does not — or nothing.
 */
export type BrainReplyClaimResult =
  | { granted: true; words: string; origin: BrainRequestOrigin }
  | { granted: false };

export function isBrainReplyClaimResult(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  if (value.granted === true)
    return isWireString(value.words) && isBrainRequestOrigin(value.origin);
  return value.granted === false;
}

/**
 * An app act the brain decided that only the renderer can perform — a settings
 * change, showing the panel, opening the feedback composer, the Updates row's
 * button — already validated against the guide in the main process. The
 * renderer performs it and answers by `requestId`.
 */
export interface BrainAppActRequest {
  requestId: string;
  action: Exclude<CarriedAppAct, { kind: "remember" | "forget" }>;
}

/** The renderer's answer to one app act: what became of it, as the brain reads outcomes. */
export type BrainAppActAnswer = WireRecord;
