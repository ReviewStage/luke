import { maximumTypedAskLength } from "@sidecar/session";
import {
  isWireString,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
  TEXT_ENDS,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { countedNumber, writtenText } from "./service-wire.js";

/**
 * A developer's ask of the hosted brain and the run it becomes, as the ask
 * routes take and answer them. The run record's vocabulary — its statuses,
 * origins, and failures, and the outcome of a submission — is declared here
 * because it is the wire's: the brain package, which owns the record's
 * behavior, imports these words rather than restating them, so the record a
 * client reads back is the record the brain wrote and the two cannot drift.
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

/**
 * Why a run ended without a reply, as a fixed word rather than a provider's
 * sentence: the host words each one for the thread, so no raw model or
 * network output reaches the developer's record.
 */
export const BRAIN_REQUEST_FAILURE = {
  /** The model did not answer, or answered nothing readable. */
  MODEL: "model",
  /** A checkpoint could not be written, so the run stopped before or after an action. */
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

export const BRAIN_SUBMISSION_OUTCOME = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
} as const;

export type BrainSubmissionOutcome =
  (typeof BRAIN_SUBMISSION_OUTCOME)[keyof typeof BRAIN_SUBMISSION_OUTCOME];

/**
 * Why a submission was refused, in a word the host words for the developer.
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

const ORIGIN_LIST = Object.values(BRAIN_REQUEST_ORIGIN);
const STATUS_LIST = Object.values(BRAIN_REQUEST_STATUS);
const FAILURE_LIST = Object.values(BRAIN_REQUEST_FAILURE);
const REJECTION_LIST = Object.values(BRAIN_SUBMISSION_REJECTION);
const ORIGIN_SET: ReadonlySet<string> = new Set(ORIGIN_LIST);

export function isBrainRequestOrigin(value: UnparsedWireValue): value is BrainRequestOrigin {
  return isWireString(value) && ORIGIN_SET.has(value);
}

/** The origins a developer's ask may arrive under over the wire; a child's task never crosses it. */
const ASK_ORIGIN_LIST = [BRAIN_REQUEST_ORIGIN.TYPED, BRAIN_REQUEST_ORIGIN.SPOKEN] as const;

/** How long a submission id may run: the client's own uuid, or any id of that size. */
export const BRAIN_SUBMISSION_ID_BOUNDS = { MAXIMUM_CHARS: 64 } as const;

/**
 * One deliberate ask (POST). The submission id is the client's, minted once
 * per ask, so a retried request finds the run the first one made rather than
 * opening a second; a request naming none is one deliberate ask and the
 * service mints one for it.
 */
export interface HostedBrainAskRequest {
  question: string;
  origin: (typeof ASK_ORIGIN_LIST)[number];
  submissionId?: string;
}

export const hostedBrainAskRequestSchema: Schema<HostedBrainAskRequest> = s.record(
  {
    question: s.text({ max: maximumTypedAskLength, ends: TEXT_ENDS.TRIM }),
    origin: s.enumOf(ASK_ORIGIN_LIST, { ends: TEXT_ENDS.TRIM }),
    submissionId: s.text({ max: BRAIN_SUBMISSION_ID_BOUNDS.MAXIMUM_CHARS }).optional(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.REFUSE },
);

/** A run as the ask routes answer it: the brain's own record, unchanged. */
export interface HostedBrainRun {
  runId: string;
  submissionId: string;
  origin: BrainRequestOrigin;
  question: string;
  status: BrainRequestStatus;
  revision: number;
  acceptedAt: number;
  startedAt?: number;
  settledAt?: number;
  /** The reply, when the run reached one. */
  text?: string;
  failure?: BrainRequestFailure;
  performedActions: number;
  unknownActions: number;
  askRecordedAt?: number;
  conversationRecordedAt?: number;
}

export const hostedBrainRunSchema: Schema<HostedBrainRun> = s.record(
  {
    runId: writtenText,
    submissionId: writtenText,
    origin: s.enumOf(ORIGIN_LIST, { ends: TEXT_ENDS.TRIM }),
    question: s.text({ ends: TEXT_ENDS.KEEP, allowEmpty: true }),
    status: s.enumOf(STATUS_LIST, { ends: TEXT_ENDS.TRIM }),
    revision: countedNumber,
    acceptedAt: countedNumber,
    startedAt: countedNumber.optional(),
    settledAt: countedNumber.optional(),
    text: s.text({ ends: TEXT_ENDS.KEEP, allowEmpty: true }).optional(),
    failure: s.enumOf(FAILURE_LIST, { ends: TEXT_ENDS.TRIM }).optional(),
    performedActions: countedNumber,
    unknownActions: countedNumber,
    askRecordedAt: countedNumber.optional(),
    conversationRecordedAt: countedNumber.optional(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** What a submission came to: the run it opened, or why it was refused. */
export type HostedBrainAskAnswer =
  | { outcome: typeof BRAIN_SUBMISSION_OUTCOME.ACCEPTED; runId: string; acceptedAt: number }
  | { outcome: typeof BRAIN_SUBMISSION_OUTCOME.REJECTED; reason: BrainSubmissionRejection };

export const hostedBrainAskAnswerSchema: Schema<HostedBrainAskAnswer> = s.union([
  s.record(
    {
      outcome: s.literal(BRAIN_SUBMISSION_OUTCOME.ACCEPTED),
      runId: writtenText,
      acceptedAt: countedNumber,
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  s.record(
    {
      outcome: s.literal(BRAIN_SUBMISSION_OUTCOME.REJECTED),
      reason: s.enumOf(REJECTION_LIST, { ends: TEXT_ENDS.TRIM }),
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
]);

/** What the wait and the cancel answer: the run as it now stands. */
export interface HostedBrainRunAnswer {
  run: HostedBrainRun;
}

export const hostedBrainRunAnswerSchema: Schema<HostedBrainRunAnswer> = s.record(
  { run: hostedBrainRunSchema },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/**
 * How long a wait on a run may hold before answering the run as it stands,
 * and the query the client names a shorter hold with. The run is not
 * abandoned at the edge: it keeps going, and the next wait answers it.
 */
export const HOSTED_BRAIN_WAIT = {
  QUERY: "wait",
  MAXIMUM_MS: 25_000,
} as const;
