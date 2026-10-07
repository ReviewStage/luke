import type { Effect } from "effect";

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
  QUESTION_QUEUED: "question_queued",
  ACTIONS_SETTLED: "actions_settled",
  REPLY_SENTENCE: "reply_sentence",
  ENDED: "ended",
  /**
   * What the run is doing now, told each time it changes: the command or the
   * tool of the call still pending, or nothing once none is. It is the live
   * brain's own and no seam of the turn-event stream, since it is shown on
   * the developer's own Mac and spoken by nobody.
   */
  ACTIVITY: "activity",
  /**
   * More of the run's calls settled since it was last told: how many have
   * settled in all, and the kind of step the latest was, in the brain's
   * slow-step vocabulary or nothing where it is none of them. It carries
   * neither a call's input nor its output, so the service words it from the
   * build.
   */
  STEP_SETTLED: "step_settled",
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
  | {
      readonly kind: typeof LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED;
      readonly runId: string;
      /** A question the planning model queued for the developer, and the answer it recommends. */
      readonly question: string;
      readonly recommendation: string;
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
    }
  | {
      readonly kind: typeof LIVE_BRAIN_RUN_EVENT.ACTIVITY;
      readonly runId: string;
      /** The pending call's command, or its tool's name where it runs none; absent while no call is pending. */
      readonly action: string | undefined;
    }
  | {
      readonly kind: typeof LIVE_BRAIN_RUN_EVENT.STEP_SETTLED;
      readonly runId: string;
      /** Which kind of step settled latest, in the brain's own vocabulary; absent for a step of no named kind. */
      readonly step: string | undefined;
      /** How many of the run's steps have settled so far. */
      readonly settled: number;
    };

export interface LiveBrainAsk {
  /** The delegation's id, as the session minted it: the one id the submission and the developer's recorded line share, so a retry finds the same run and a record can tie the line to the run's turn. */
  submissionId: string;
  /** The role-labelled transcript span the delegation is about, the developer's latest line marked as the ask. */
  question: string;
  /** The voice session the delegation came in on, so a later connection to it can find the ask again. */
  sessionId: string;
  /** The ask's task revision in that session's order of delegations: a higher one supersedes a lower. */
  revision: number;
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

/** What asking the brain to cancel a run came to: cancelled, nothing left to cancel, or a cancel the backend did not take. */
export const LIVE_BRAIN_CANCEL = {
  /** The backend took the cancel: the run stops, or will never start its work. */
  CANCELLED: "cancelled",
  /** The run had already ended, or the brain holds nothing under its id. */
  NOT_RUNNING: "not_running",
  /** The backend could not be reached or refused the cancel; the run may still be under way. */
  FAILED: "failed",
} as const;

export type LiveBrainCancel = (typeof LIVE_BRAIN_CANCEL)[keyof typeof LIVE_BRAIN_CANCEL];

/** One run a re-attached connection takes up again, as the brain's record holds it. */
export interface LiveBrainRecoveredRun {
  readonly runId: string;
  /** The delegation the run answers, still open in the session the run was asked in. */
  readonly delegationId: string;
  readonly revision: number;
  /** The developer stopped it: its cancel was already asked, and nothing of it is to be said. */
  readonly stopped: boolean;
  /** It ended too long before this connection to be news: nothing of it is to be said. */
  readonly stale: boolean;
}

/**
 * What a re-attached connection takes up of the runs an earlier connection
 * to the same session accepted: the session's newest revision, settled or
 * not, so an older run stays superseded; the runs not yet told to their end;
 * and the follow that tells them from where the last telling stopped, which
 * the caller runs once it can hear them.
 */
export interface LiveBrainRecovery {
  readonly revision: number;
  readonly runs: readonly LiveBrainRecoveredRun[];
  readonly follow: Effect.Effect<void>;
}

export interface LiveBrain {
  /**
   * Submits a spoken ask under the spoken origin. An ask that arrives while
   * a run is under way is the brain's to queue behind it or fold with
   * others waiting; the answer names a run of the ask's own, and where asks
   * share one backend turn, the newest of them is the run that carries the
   * turn's words, since the service speaks the newest request's reply alone.
   */
  submitAsk(ask: LiveBrainAsk): Effect.Effect<LiveBrainSubmission>;
  /**
   * Asks the backend to cancel one run, answering only once the backend has
   * said whether it took the cancel, so nothing is told of a cancel that did
   * not happen. The run still ends through its own seam.
   */
  cancelRun(runId: string): Effect.Effect<LiveBrainCancel>;
  /**
   * The runs an earlier connection to the session accepted and did not tell
   * to their end, read back from the brain's record. Each is told again only
   * from the event after the last one told, so nothing is said twice; what
   * was told just before a connection was lost may be said never.
   */
  recoverRuns(sessionId: string): Effect.Effect<LiveBrainRecovery>;
  /** Hears the run seams for every run the brain holds; the service reads the kinds it knows by name. */
  onRunEvent(listener: (event: LiveBrainRunEvent) => void): () => void;
}
