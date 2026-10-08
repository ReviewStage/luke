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
