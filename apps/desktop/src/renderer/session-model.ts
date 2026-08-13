import {
  ATTENTION_DISPOSITION,
  type NormalizedSession,
  SESSION_STATE,
  SESSION_STATUS,
  type SessionLocation,
  type SessionState,
} from "@sidecar/core";
import type { AppBootstrap } from "../shared/contracts";

export const STATE_LABEL: Record<SessionState, string> = {
  [SESSION_STATE.WORKING]: "Working",
  [SESSION_STATE.ATTENTION]: "Needs you",
  [SESSION_STATE.COMPLETE]: "Complete",
  [SESSION_STATE.UNKNOWN]: "Idle",
};

const CONTEXT_SEPARATOR = " · ";

/** The state order the surface reads top-down and the badge collapses to. */
const STATE_PRIORITY: readonly SessionState[] = [
  SESSION_STATE.ATTENTION,
  SESSION_STATE.WORKING,
  SESSION_STATE.COMPLETE,
  SESSION_STATE.UNKNOWN,
];

export interface DisplaySession {
  id: string;
  title: string;
  providerId: string;
  provider: string;
  /** What the session is doing, or what stopped it. */
  detail: string;
  /** Where it is doing it: provider, repository, branch, model. */
  context: string;
  state: SessionState;
  label: string;
  location: SessionLocation;
}

export interface ProviderTally {
  providerId: string;
  provider: string;
  total: number;
  attention: number;
}

export interface SessionTally {
  total: number;
  attention: number;
  working: number;
  complete: number;
  idle: number;
  /** The state the count badge and the notch capsule adopt. */
  state: SessionState;
  providers: readonly ProviderTally[];
}

function sessionNeedsAttention(session: NormalizedSession): boolean {
  return (
    session.status === SESSION_STATUS.WAITING ||
    // A session that stopped on a failure cannot get itself going again, so it
    // wants a person at least as much as one that finished its turn.
    session.status === SESSION_STATUS.ERROR ||
    session.attention.disposition !== ATTENTION_DISPOSITION.SILENT
  );
}

/**
 * The line under the title. What stopped a session outranks what it was doing,
 * and what it was doing outranks the recap of a turn that has already ended.
 *
 * It is empty when a provider reported none of them. Falling back to the status
 * would only restate the chip at the other end of the same row.
 */
function sessionDetail(session: NormalizedSession): string {
  return session.detail.error ?? session.detail.activity ?? session.summary ?? "";
}

/**
 * The line under that. It answers "which one is this?" for the rows that would
 * otherwise read alike — two checkouts of one repository, or one repository on
 * two branches.
 */
function sessionContext(session: NormalizedSession): string {
  return [
    session.provider.displayName,
    session.detail.repository,
    session.detail.branch,
    session.detail.model,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(CONTEXT_SEPARATOR);
}

function sessionState(session: NormalizedSession): SessionState {
  if (sessionNeedsAttention(session)) return SESSION_STATE.ATTENTION;
  if (session.status === SESSION_STATUS.COMPLETE) return SESSION_STATE.COMPLETE;
  if (session.status === SESSION_STATUS.UNKNOWN) return SESSION_STATE.UNKNOWN;
  return SESSION_STATE.WORKING;
}

export function displaySessions(
  bootstrap: AppBootstrap,
  sessions: readonly NormalizedSession[],
): readonly DisplaySession[] {
  const visible: readonly DisplaySession[] = bootstrap.fixtureMode
    ? bootstrap.fixture.sessions.map((session) => ({
        ...session,
        label: STATE_LABEL[session.state],
      }))
    : sessions.map((session) => ({
        id: session.providerSessionId,
        title: session.title,
        providerId: session.providerId,
        provider: session.provider.displayName,
        detail: sessionDetail(session),
        context: sessionContext(session),
        state: sessionState(session),
        label: STATE_LABEL[sessionState(session)],
        location: session.location,
      }));

  return [...visible].sort(
    (first, second) => STATE_PRIORITY.indexOf(first.state) - STATE_PRIORITY.indexOf(second.state),
  );
}

export function sessionTally(sessions: readonly DisplaySession[]): SessionTally {
  const providers = new Map<string, ProviderTally>();
  const counts = { attention: 0, working: 0, complete: 0, idle: 0 };

  for (const session of sessions) {
    if (session.state === SESSION_STATE.ATTENTION) counts.attention += 1;
    else if (session.state === SESSION_STATE.WORKING) counts.working += 1;
    else if (session.state === SESSION_STATE.COMPLETE) counts.complete += 1;
    else counts.idle += 1;

    const tally = providers.get(session.providerId) ?? {
      providerId: session.providerId,
      provider: session.provider,
      total: 0,
      attention: 0,
    };
    providers.set(session.providerId, {
      ...tally,
      total: tally.total + 1,
      attention: tally.attention + (session.state === SESSION_STATE.ATTENTION ? 1 : 0),
    });
  }

  return {
    ...counts,
    total: sessions.length,
    state: dominantState(counts),
    providers: [...providers.values()],
  };
}

function dominantState(counts: {
  attention: number;
  working: number;
  complete: number;
}): SessionState {
  if (counts.attention > 0) return SESSION_STATE.ATTENTION;
  if (counts.working > 0) return SESSION_STATE.WORKING;
  if (counts.complete > 0) return SESSION_STATE.COMPLETE;
  return SESSION_STATE.UNKNOWN;
}

/** One sentence that reads correctly for a screen reader in either mode. */
export function tallySummary(tally: SessionTally): string {
  if (tally.total === 0) return "No sessions tracked";
  const sessionWord = tally.total === 1 ? "session" : "sessions";
  if (tally.attention > 0) {
    return `${tally.total} ${sessionWord} tracked, ${tally.attention} needing you`;
  }
  if (tally.working > 0) return `${tally.total} ${sessionWord} tracked, ${tally.working} working`;
  return `${tally.total} ${sessionWord} tracked`;
}

/**
 * The caption beside the count once the panel has room for it. The badge shows
 * how many sessions are tracked, so the caption has to name its own number:
 * "4 · 1 needs you" rather than "4 · needs you".
 */
export function tallyCaption(tally: SessionTally): string {
  if (tally.total === 0) return "none tracked";
  if (tally.attention > 0) {
    return `${tally.attention} ${tally.attention === 1 ? "needs" : "need"} you`;
  }
  if (tally.working > 0) return `${tally.working} working`;
  if (tally.complete > 0) return `${tally.complete} complete`;
  return "tracked";
}
