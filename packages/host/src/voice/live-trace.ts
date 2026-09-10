/**
 * What the live session records in the development trace: a decision beside a
 * count, never a word said, in the same shape the speech arbiter's decisions
 * take so the one writer and the one exporter read both.
 */

export const LIVE_TRACE_KIND = "live-session";

export const LIVE_TRACE_DECISION = {
  CREATED: "created",
  STARTED: "started",
  APPENDED: "appended",
  APPEND_REFUSED: "append-refused",
  DELEGATED: "delegated",
  RETAINED: "retained",
  SPOKEN: "spoken",
  UNSETTLED: "unsettled",
  DROPPED: "dropped",
  HELD: "held",
  CLOSED: "closed",
  CONNECTION_LOST: "connection-lost",
  INFO: "info",
} as const;

export type LiveTraceDecision = (typeof LIVE_TRACE_DECISION)[keyof typeof LIVE_TRACE_DECISION];

export interface LiveTraceRecord {
  kind: typeof LIVE_TRACE_KIND;
  decision: LiveTraceDecision;
  pendingCount: number;
}

export type LiveTrace = (decision: LiveTraceDecision) => void;
