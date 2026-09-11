/**
 * The one door the live session service reaches Luke's judgment through. It
 * is transport-neutral on purpose: ids and plain data cross it, never a brain
 * class, so the in-process agent that answers it today and a hosted brain
 * reached over HTTP tomorrow are two implementations of one contract, and
 * the service that speaks for the developer's coding agents moves between
 * them without changing. Every ask that crosses it is a spoken one, minted
 * here with its own submission id: the service keeps its own ids apart from
 * the voice model's delegation ids, as the delegation guide says to.
 */

/** The run seams the service consumes, named one by one; a newer brain may fire kinds this build does not read. */
export const LIVE_BRAIN_RUN_EVENT = {
  SLOW_STEP: "slow_step",
  ACTIONS_SETTLED: "actions_settled",
  REPLY_SENTENCE: "reply_sentence",
  ENDED: "ended",
} as const;

/** How a run ended, as the service tells a reply from a refusal. */
export const LIVE_BRAIN_RUN_END = {
  /** The run produced its reply; whatever sentences it had were streamed. */
  COMPLETED: "completed",
  /** The developer, or a drain, stopped it before a reply formed. */
  CANCELLED: "cancelled",
  /** The run could not finish for a reason of its own. */
  FAILED: "failed",
} as const;

export type LiveBrainRunEnd = (typeof LIVE_BRAIN_RUN_END)[keyof typeof LIVE_BRAIN_RUN_END];

export type LiveBrainRunEvent =
  | {
      readonly kind: typeof LIVE_BRAIN_RUN_EVENT.SLOW_STEP;
      readonly runId: string;
      /** Which kind of slow step began, in the brain's own vocabulary; the service words it. */
      readonly step: string;
    }
  | { readonly kind: typeof LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED; readonly runId: string }
  | {
      readonly kind: typeof LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE;
      readonly runId: string;
      readonly sentence: string;
    }
  | {
      readonly kind: typeof LIVE_BRAIN_RUN_EVENT.ENDED;
      readonly runId: string;
      readonly end: LiveBrainRunEnd;
    };

export interface LiveBrainAsk {
  /** The service's own id for this one submission; a retry of it finds the same run. */
  submissionId: string;
  /** The role-labelled transcript span the delegation is about, the developer's latest line marked as the ask. */
  question: string;
}

export const LIVE_BRAIN_SUBMISSION = {
  ACCEPTED: "accepted",
  REFUSED: "refused",
} as const;

export type LiveBrainSubmission =
  | { outcome: typeof LIVE_BRAIN_SUBMISSION.ACCEPTED; runId: string }
  | {
      outcome: typeof LIVE_BRAIN_SUBMISSION.REFUSED;
      /** The standing sentence the refusal is spoken as, fixed by the brain and never composed with the ask. */
      refusal: string;
    };

export interface LiveBrain {
  /**
   * Submits a spoken ask under the spoken origin. An ask that arrives while
   * a run is under way is the brain's to steer into it or queue behind it;
   * either way the answer names the run the record was accepted into, and
   * the run seams below say which run's reply carries the words.
   */
  submitAsk(ask: LiveBrainAsk): Promise<LiveBrainSubmission>;
  /** Hears the run seams for every run the brain holds; the service reads the kinds it knows by name. */
  onRunEvent(listener: (event: LiveBrainRunEvent) => void): () => void;
}
