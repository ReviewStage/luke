import type { CarriedAppAction } from "@sidecar/actions";
import { maximumTypedAskLength } from "@sidecar/session";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
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
} from "./requests.js";

/**
 * What crosses the bridge between the brain in the main process and the
 * windows. The brain decides and actions on its own side; what reaches a
 * renderer is the record of a run it submitted or is drawing, and the few app
 * actions only a renderer can perform. A briefing travels as a speech offer
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

/** A run the renderer may still cancel: accepted, not yet ended. */
export function brainRequestPending(snapshot: BrainRequestSnapshot): boolean {
  return (
    snapshot.status === BRAIN_REQUEST_STATUS.QUEUED ||
    snapshot.status === BRAIN_REQUEST_STATUS.RUNNING
  );
}

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

function isReceiverEpoch(value: UnparsedWireValue): value is number {
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
 * whose end already stands in Conversation and whose one grant this wait took; a
 * run still going, or one whose words another path holds, is not the
 * call's to say.
 */
export interface BrainAskWait {
  record: BrainRequestSnapshot | undefined;
  speak: boolean;
}

/**
 * The main process's answer to a claim: the words to say, once, with the
 * origin of the ask they answer — a typed ask's reply holds the composer's
 * caption, a spoken one's does not — or nothing.
 */
export type BrainReplyClaimResult =
  | { granted: true; words: string; origin: BrainRequestOrigin }
  | { granted: false };

/**
 * An app act the brain decided that only the renderer can perform — a settings
 * change, showing the panel, opening the feedback composer, the Updates row's
 * button — already validated against the guide in the main process. The
 * renderer performs it and answers by `requestId`.
 */
export interface BrainAppActionRequest {
  requestId: string;
  action: Exclude<CarriedAppAction, { kind: "remember" | "forget" }>;
}

/** The renderer's answer to one app act: what became of it, as the brain reads outcomes. */
export type BrainAppActionAnswer = WireRecord;
