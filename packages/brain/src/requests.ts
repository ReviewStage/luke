import type { ModelUsage } from "@sidecar/runtime/vocabulary";

/**
 * A developer ask as the brain owns it from acceptance to its end. The record
 * outlives the call that asked, the renderer that showed it, and the launch
 * that ran it: a submission is acknowledged only once its record is on disk,
 * a wait answers with the record as it stands rather than abandoning the run,
 * and a restart finds every unfinished record and marks it interrupted rather
 * than resuming an action it cannot know the state of.
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

/** Where the ask came from: the developer's own voice, or a requester's spawn. */
export const BRAIN_REQUEST_ORIGIN = {
  /** Spoken; the voice service's own transcript is the record, and the question here is the host's relay of it. */
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

/**
 * What a run's inferences cost, summed over every answer the run was given
 * and split the four ways the provider counts: the input the model read, the
 * output it wrote, how much of the input its prefix cache answered, and how
 * much of the output was reasoning before the words. A count the provider
 * did not say adds nothing, so every field is a number from the first answer.
 */
export interface BrainRunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

/** One answer's counts added onto a run's so far (nothing, before its first answer), each missing count counting as nothing. */
export function addModelUsage(total: BrainRunUsage | undefined, usage: ModelUsage): BrainRunUsage {
  return {
    inputTokens: (total?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    cachedInputTokens: (total?.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
    reasoningTokens: (total?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
  };
}
