export const TURN_ORIGIN = {
  TYPED: "typed",
  SPOKEN: "spoken",
  TRANSCRIPT_CHANGE: "transcript_change",
  CHILD: "child",
  CHILD_COMPLETION: "child_completion",
} as const;

export type TurnOrigin = (typeof TURN_ORIGIN)[keyof typeof TURN_ORIGIN];

export const TURN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SETTLED: "settled",
  CANCELED: "cancelled",
  FAILED: "failed",
} as const;

export type TurnStatus = (typeof TURN_STATUS)[keyof typeof TURN_STATUS];
