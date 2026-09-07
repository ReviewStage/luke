import type { CarriedAppAction } from "@sidecar/acts";
import {
  BRAIN_REQUEST_FAILURE,
  type BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestRecord,
  type BrainSubmissionRejection,
  brainRequestRecordFromWire,
  isBrainRequestOrigin,
} from "@sidecar/brain/requests";
import { maximumTypedAskLength } from "@sidecar/realtime";
import {
  type ACT_RESULT_STATUS,
  isRecord,
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

export function isBrainAskSubmissionResult(value: UnparsedWireValue): boolean {
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
} as const satisfies Record<BrainSubmissionRejection, string>;

/** What the voice says while a run is still going when its wait ran out. */
export const BRAIN_ASK_PENDING_NOTE = "I'm still working on that. I'll tell you when it's done.";

function actsPhrase(count: number): string {
  return count === 1 ? "one thing you asked" : `${count} things you asked`;
}

/**
 * The words a run's end leaves in the thread and in the voice's mouth, built
 * from the record alone. A reply the model reached is said as it stands; an
 * end without one is worded here in fixed sentences that say what was done
 * before it, so an act that went through is never reported as nothing having
 * happened, and a reply that failed to form is never reported as the acts
 * failing. Nothing a model or a provider wrote enters except the reply text.
 */
export function brainReplyWords(snapshot: BrainRequestSnapshot): string | undefined {
  const done = snapshot.performedActs;
  switch (snapshot.status) {
    case BRAIN_REQUEST_STATUS.QUEUED:
    case BRAIN_REQUEST_STATUS.RUNNING:
      return undefined;
    case BRAIN_REQUEST_STATUS.SUCCEEDED:
      if (snapshot.text) return snapshot.text;
      return done > 0 ? `Done: I did ${actsPhrase(done)}.` : "I had nothing to add to that.";
    case BRAIN_REQUEST_STATUS.FAILED:
      if (snapshot.failure === BRAIN_REQUEST_FAILURE.PERSISTENCE) {
        const said = snapshot.text ? `${snapshot.text} ` : "";
        return done > 0
          ? `${said}I did ${actsPhrase(done)}, but I couldn't save my notes about it.`
          : `${said}I couldn't save my notes about that ask, so I stopped before doing anything.`;
      }
      return done > 0
        ? `I did ${actsPhrase(done)}, but I couldn't put the reply into words.`
        : "I couldn't work that one out. Ask me again in a moment.";
    case BRAIN_REQUEST_STATUS.CANCELLED:
      return done > 0
        ? `Cancelled, though ${actsPhrase(done)} had already gone through.`
        : "Cancelled.";
    case BRAIN_REQUEST_STATUS.TIMED_OUT:
      return done > 0
        ? `That ask ran out of time after ${actsPhrase(done)} had gone through.`
        : "That ask ran out of time.";
    case BRAIN_REQUEST_STATUS.INTERRUPTED:
      return done > 0
        ? `That ask was interrupted after ${actsPhrase(done)} had gone through.`
        : "That ask was interrupted before I could finish it.";
  }
}

/** The tool output's status when the run is still going: neither an answer nor a refusal. */
export const BRAIN_ASK_PENDING_STATUS = "pending";

/**
 * What the voice's `ask_brain` tool comes back with: the reply for the voice
 * to say, the honest note that the run is still going, or a bounded refusal
 * the voice can say instead.
 */
export type BrainAskResult =
  | { status: typeof ACT_RESULT_STATUS.ACCEPTED; briefing: string }
  | { status: typeof BRAIN_ASK_PENDING_STATUS; note: string }
  | { status: typeof ACT_RESULT_STATUS.REJECTED; reason: string };

/**
 * An app act the brain decided that only the renderer can perform — a settings
 * change, showing the panel, opening the feedback composer, the Updates row's
 * button — already validated against the guide in the main process. The
 * renderer performs it and answers by `requestId`.
 */
export interface BrainAppActRequest {
  requestId: string;
  action: Exclude<CarriedAppAction, { kind: "remember" | "forget" }>;
}

/** The renderer's answer to one app act: what became of it, as the brain reads outcomes. */
export type BrainAppActAnswer = WireRecord;
