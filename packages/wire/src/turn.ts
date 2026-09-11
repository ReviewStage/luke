/**
 * What a turn row says about the run it records: what opened it and where it
 * stands. Every trigger the brain answers to is a queued turn — a developer's
 * typed or spoken ask, a roster diff, a hold's release, a child's completion —
 * and the origin is the record of which, so a view can mark an action Luke
 * took on his own judgment apart from one the developer asked for. Declared
 * here so the store that writes the row, the service that answers it, and the
 * clients that fold a turn by it all spell the same words.
 */

export const TURN_ORIGIN = {
  TYPED: "typed",
  SPOKEN: "spoken",
  ROSTER_DIFF: "roster_diff",
  HOLD_RELEASE: "hold_release",
  /** A child run's own turn, opened by the task it was delegated. */
  CHILD: "child",
  /**
   * The requester's turn, opened because a child it delegated to finished.
   * Kept apart from `child` because the two record different judgments: the
   * child's turn is the child's, this one is the parent's, and a reader
   * tracing why Luke spoke should not have to infer which from the
   * conversation's kind.
   */
  CHILD_COMPLETION: "child_completion",
} as const;

export type TurnOrigin = (typeof TURN_ORIGIN)[keyof typeof TURN_ORIGIN];

export const TURN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SETTLED: "settled",
  CANCELLED: "cancelled",
  FAILED: "failed",
} as const;

export type TurnStatus = (typeof TURN_STATUS)[keyof typeof TURN_STATUS];
