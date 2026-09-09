import type { Session } from "./session-shape.js";
import { SESSION_STATUS, type SessionStatus } from "./session-status.js";

/**
 * How long a status keeps its session on the roster, measured from the
 * provider's last activity. This is the one bound on the roster — no adapter
 * ages out or caps its sessions: relevance follows what the status asks of the
 * user, never a blanket clock over every conversation. A failure does not heal
 * by going stale, but a rescue nobody made for days is a session the user has
 * left behind; a settled or unreadable session says only where work ended,
 * which is news while the user might still come back for it and history after.
 */
export const SESSION_ROSTER_RETENTION_MS = {
  RESCUE_MS: 3 * 24 * 60 * 60 * 1000,
  SETTLED_MS: 2 * 24 * 60 * 60 * 1000,
} as const;

/** The retention one status earns. */
export function sessionRosterRetentionMs(status: SessionStatus): number {
  if (status === SESSION_STATUS.ERROR) return SESSION_ROSTER_RETENTION_MS.RESCUE_MS;
  if (status === SESSION_STATUS.COMPLETE || status === SESSION_STATUS.UNKNOWN) {
    return SESSION_ROSTER_RETENTION_MS.SETTLED_MS;
  }
  // Working and waiting are live right now, so neither expires: the age of
  // the ask is not the age of its relevance.
  return Number.POSITIVE_INFINITY;
}

/** Whether a session's status still earns it a place on the roster. */
export function isRosterRelevant(
  session: Pick<Session, "status" | "lastActivityAt" | "standing">,
  now: number,
): boolean {
  // Retention ages out history — settled chats whose files linger after the
  // work ended. A standing session is not history: its provider re-reports it
  // while the thing it names still exists and stops the moment it is gone, so
  // there is nothing here to age out, however old its own timestamp grows.
  if (session.standing) return true;
  return now - session.lastActivityAt <= sessionRosterRetentionMs(session.status);
}

/** The sessions still worth a row, in the order they arrived. */
export function rosterRelevantSessions(
  sessions: readonly Session[],
  now: number,
): readonly Session[] {
  return sessions.filter((session) => isRosterRelevant(session, now));
}
