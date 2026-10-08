/**
 * A turn's events: what the voice hears of a turn it asked while the turn
 * runs. The kinds are the run seams the live session service consumes — a
 * slow step began, a planning turn queued a question, every action settled,
 * one sentence of the reply, the turn ended — and nothing wider: no tool
 * part, no reasoning, and no message, only what a voice needs to speak
 * commentary while the turn runs. Each event is numbered from one inside its
 * turn, so a reader that took some hears the rest exactly once. The same
 * words as the brain's own run stream, spelled here because this package
 * cannot reach the brain; a test above both holds them equal.
 */

export const TURN_EVENT_KIND = {
  /** The turn began a step slow enough to be worth telling the developer about; at most once per turn. */
  SLOW_STEP: "slow_step",
  /** A planning turn queued one question for the voice to ask when it reaches it; told as the call is journaled, before the turn ends. */
  QUESTION_QUEUED: "question_queued",
  /** Every action the turn has journaled by now has its result on the record; the reply's sentences follow, the first while the turn may still run. */
  ACTIONS_SETTLED: "actions_settled",
  /** One sentence of the reply, in order, after the actions settled. */
  REPLY_SENTENCE: "reply_sentence",
  /** The turn reached a terminal status; it is the last event of every turn. */
  ENDED: "ended",
} as const;

export type TurnEventKind = (typeof TURN_EVENT_KIND)[keyof typeof TURN_EVENT_KIND];

/** Which kind of slow step began: a whole transcript read, a write the provider carries, or a planning call's look into its repository. */
export const TURN_SLOW_STEP = {
  TRANSCRIPT_READ: "transcript_read",
  PROVIDER_WRITE: "provider_write",
  REPOSITORY_READ: "repository_read",
} as const;

export type TurnSlowStep = (typeof TURN_SLOW_STEP)[keyof typeof TURN_SLOW_STEP];

/** How a turn ended, as a client tells a reply from a refusal. */
export const TURN_END = {
  /** The turn answered; whatever sentences it had were told ahead of this. */
  COMPLETED: "completed",
  /** The developer, or a drain, stopped it before a reply formed. */
  CANCELLED: "cancelled",
  /** The turn could not finish for a reason of its own. */
  FAILED: "failed",
} as const;

export type TurnEnd = (typeof TURN_END)[keyof typeof TURN_END];

/** What every event carries beside its own fields: the turn it belongs to and its place in that turn. */
interface TurnEventBase {
  readonly turnId: string;
  /** The event's place in the turn, numbered from one. */
  readonly seq: number;
}

export type TurnEventBody =
  | { readonly kind: typeof TURN_EVENT_KIND.SLOW_STEP; readonly step: TurnSlowStep }
  | {
      readonly kind: typeof TURN_EVENT_KIND.QUESTION_QUEUED;
      readonly question: string;
      readonly recommendation: string;
    }
  | { readonly kind: typeof TURN_EVENT_KIND.ACTIONS_SETTLED }
  | { readonly kind: typeof TURN_EVENT_KIND.REPLY_SENTENCE; readonly sentence: string }
  | { readonly kind: typeof TURN_EVENT_KIND.ENDED; readonly end: TurnEnd };

export type TurnEvent = TurnEventBody & TurnEventBase;
