/**
 * What a turn row says about the run it records: what opened it and where it
 * stands. Every turn is a developer's ask, typed or spoken, and the origin is
 * the record of which channel carried it. Declared here so the store that
 * writes the row, the service that answers it, and the clients that fold a
 * turn by it all spell the same words.
 */

export const TURN_ORIGIN = {
  TYPED: "typed",
  SPOKEN: "spoken",
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
