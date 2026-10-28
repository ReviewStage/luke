/**
 * What opened a turn, as the hosted brain host names it on a turn's record
 * and the trace: the vocabulary is the brain's own so the store, the event
 * stream, and the trace all spell one set.
 */
export const BRAIN_TURN_TRIGGER = {
  ASK: "ask",
  /** A child's own run: the delegated task (eve's subagent task, not a Luke task), whose final text is the result its requester is handed. */
  CHILD_TASK: "child-task",
} as const;

export type BrainTurnTrigger = (typeof BRAIN_TURN_TRIGGER)[keyof typeof BRAIN_TURN_TRIGGER];
