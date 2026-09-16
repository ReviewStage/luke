import { RUN_ORIGIN, type RunOrigin } from "@sidecar/runtime/vocabulary";

/**
 * What opened a turn, as the hosted brain host names it on a turn's record
 * and the trace: the vocabulary is the brain's own so the store, the event
 * stream, and the trace all spell one set.
 */
export const BRAIN_TURN_TRIGGER = {
  WAKE: "wake",
  ROSTER: "roster",
  ASK: "ask",
  /** A child's own run: the delegated task, whose final text is the result its requester is handed. */
  CHILD_TASK: "child-task",
  /** A requester's turn opened by a child's completion, when no run of its own was there to steer. */
  CHILD_COMPLETION: "child-completion",
} as const;

export type BrainTurnTrigger = (typeof BRAIN_TURN_TRIGGER)[keyof typeof BRAIN_TURN_TRIGGER];

/** Who or what opened a turn of this kind: attribution for the record and the trace, never a permission. */
export function runOriginOf(trigger: BrainTurnTrigger): RunOrigin {
  switch (trigger) {
    case BRAIN_TURN_TRIGGER.ASK:
      return RUN_ORIGIN.USER;
    case BRAIN_TURN_TRIGGER.CHILD_TASK:
      return RUN_ORIGIN.CHILD;
    case BRAIN_TURN_TRIGGER.CHILD_COMPLETION:
      return RUN_ORIGIN.CHILD_COMPLETION;
    default:
      return RUN_ORIGIN.OBSERVATION;
  }
}
