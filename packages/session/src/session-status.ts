/**
 * Provider-observed condition. `SESSION_URGENCY`, the ranked disposition a
 * surface draws a row by, prefixes its own literals, so neither value set can
 * be passed where the other is expected.
 */
export const SESSION_STATUS = {
  WORKING: "working",
  WAITING: "waiting",
  /**
   * The session stopped on something it cannot get past on its own. Providers
   * report this natively — a Conductor `error`, a Claude
   * Code `api_error` — and it is kept distinct from `waiting` because the two
   * ask different things of the developer: one wants an answer, the other wants
   * a rescue.
   */
  ERROR: "error",
  COMPLETE: "complete",
  UNKNOWN: "unknown",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export const SESSION_COMPLETION_CAUSE = {
  WORK_FINISHED: "work-finished",
  SESSION_CLOSED: "session-closed",
} as const;

export type SessionCompletionCause =
  (typeof SESSION_COMPLETION_CAUSE)[keyof typeof SESSION_COMPLETION_CAUSE];

/**
 * Only waiting decays; a failure does not heal by going stale. Providers
 * report live state and when they last wrote about the session, never a
 * heartbeat — so a long turn is still working and a completed or failed
 * session stays that way however long ago it finished. A waiting session
 * whose provider has written nothing for a while is one Luke cannot tell
 * apart from a turn the user walked away from hours ago, and reporting the
 * stale state would speak at the wrong moment.
 *
 * The decay is for asks that are inferences — a transcript's turn that ended,
 * a chat a provider reports as merely idle. An adapter whose provider asserts
 * that a session is holding for the user right now — a plan awaiting
 * approval, a task waiting for input, a tool call holding for permission —
 * keeps that status out of this helper: the ask stands until the provider
 * stops reporting it, because it is a live fact rather than a guess about
 * where a quiet session left off.
 */
export function agedStatus(
  status: SessionStatus,
  lastActivityAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (status !== SESSION_STATUS.WAITING) return status;
  return now - lastActivityAt <= freshnessMs ? status : SESSION_STATUS.UNKNOWN;
}

/**
 * Shared bounds for every provider. A session reads the same whether Luke
 * observed it on disk or over the network. There is deliberately no maximum
 * session age: a conversation is never hidden for being old, only crowded out
 * by newer ones when a provider's count budget fills. Each adapter's budget —
 * newest first — is what bounds the roster and the observation pass.
 */
export const OBSERVATION_WINDOW = {
  ACTIVE_SESSION_FRESHNESS_MS: 15 * 60 * 1000,
} as const;
