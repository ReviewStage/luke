import {
  SESSION_STATUS,
  SESSION_URGENCY,
  type Session,
  type SessionUrgency,
} from "@sidecar/session";
import type { FixtureSnapshot } from "@sidecar/session/fixtures";
import { compareSessionsByUrgency } from "@sidecar/surface";
import type { AppState } from "#shared/messages/app-state";

/**
 * session-model.ts -- the sessions Luke is watching as Luke's face counts them, and the word search the settings search shares.
 */

/** One session as it is counted: whose it is, the apps holding it, and where it stands. */
export interface SessionView {
  id: string;
  providerId: string;
  provider: string;
  applications: readonly { id: string; name: string }[];
  urgency: SessionUrgency;
  lastActivityAt: number;
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
  /**
   * The same sessions the count above counts, by id, because one of them
   * starting to ask is a different event from three of them still asking and
   * the count cannot tell those apart: answer one while another starts in the
   * same poll and it never moves. Luke's face reacts to the event and the
   * spoken summary reports the count, so the tally has to carry both.
   */
  attentionIds: readonly string[];
  working: number;
  complete: number;
  idle: number;
  /** One app each, seated where its most urgent session reads. */
  providers: readonly ProviderTally[];
}

function sessionNeedsAttention(session: Session): boolean {
  return (
    session.status === SESSION_STATUS.WAITING ||
    // A session that stopped on a failure cannot get itself going again, so it
    // wants a person at least as much as one that finished its turn.
    session.status === SESSION_STATUS.ERROR
  );
}

function sessionUrgency(session: Session): SessionUrgency {
  if (sessionNeedsAttention(session)) return SESSION_URGENCY.ATTENTION;
  if (session.status === SESSION_STATUS.COMPLETE) return SESSION_URGENCY.COMPLETE;
  if (session.status === SESSION_STATUS.UNKNOWN) return SESSION_URGENCY.UNKNOWN;
  return SESSION_URGENCY.WORKING;
}

/**
 * A query read into the words it asks for: lowercased and split on whitespace,
 * because matching is case-blind and every word must be found somewhere. A
 * blank query has no words, which is what makes it no search at all.
 */
export function searchTokens(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Every one of a query's words somewhere in the lines read: words narrow, they
 * never widen.
 */
export function matchesTokens(lines: readonly string[], tokens: readonly string[]): boolean {
  const read = lines.map((line) => line.toLowerCase());
  return tokens.every((token) => read.some((line) => line.includes(token)));
}

/** One stretch of a drawn line that a query's word landed on. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * Where a query's words sit in one drawn line, so the line can show why it
 * matched. Every occurrence of every word is taken and overlapping stretches
 * are merged, because two words landing on one stretch of text should read as
 * one mark rather than nested ones.
 */
export function matchRanges(text: string, tokens: readonly string[]): readonly MatchRange[] {
  const lowered = text.toLowerCase();
  const found: MatchRange[] = [];
  for (const token of tokens) {
    for (let from = lowered.indexOf(token); from !== -1; from = lowered.indexOf(token, from + 1)) {
      found.push({ start: from, end: from + token.length });
    }
  }
  found.sort((first, second) => first.start - second.start || first.end - second.end);
  const merged: MatchRange[] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** A fixture's sessions, most urgent first. */
export function fixtureSessions(fixture: FixtureSnapshot): readonly SessionView[] {
  return fixture.sessions
    .map((session) => ({
      id: session.id,
      providerId: session.providerId,
      provider: session.provider,
      applications: (session.applications ?? []).map(({ id, name }) => ({ id, name })),
      urgency: session.urgency,
      lastActivityAt: session.lastActivityAt,
    }))
    .sort(compareSessionsByUrgency);
}

/** An observed roster's sessions, most urgent first. */
export function observedSessions(sessions: readonly Session[]): readonly SessionView[] {
  return sessions
    .map((session) => ({
      id: session.providerSessionId,
      providerId: session.providerId,
      provider: session.provider.displayName,
      applications: session.applications.map((application) => ({
        id: application.id,
        name: application.displayName,
      })),
      urgency: sessionUrgency(session),
      lastActivityAt: session.lastActivityAt,
    }))
    .sort(compareSessionsByUrgency);
}

/**
 * The sessions this window counts, read from the document alone: a fixture
 * run's own sessions, or the roster the observation passes reported.
 */
export function displaySessions(state: Pick<AppState, "run" | "sessions">): readonly SessionView[] {
  return state.run.fixtureMode
    ? fixtureSessions(state.run.fixture)
    : observedSessions(state.sessions.roster.sessions);
}

/**
 * Counted across everything tracked, read most urgent first, so the apps sit
 * in the order their first sessions do.
 */
export function sessionTally(sessions: readonly SessionView[]): SessionTally {
  const providers = new Map<string, ProviderTally>();
  const counts = { attention: 0, working: 0, complete: 0, idle: 0 };
  const attentionIds: string[] = [];

  for (const session of [...sessions].sort(compareSessionsByUrgency)) {
    if (session.urgency === SESSION_URGENCY.ATTENTION) {
      counts.attention += 1;
      attentionIds.push(session.id);
    } else if (session.urgency === SESSION_URGENCY.WORKING) counts.working += 1;
    else if (session.urgency === SESSION_URGENCY.COMPLETE) counts.complete += 1;
    else counts.idle += 1;

    // The app holding the chat — the lead of its application marks, which
    // the workspace manager already heads — so the count says where the
    // tracked work is held rather than which agent runs it. A chat no app
    // holds still counts under its provider's own mark.
    const application = session.applications[0];
    const markId = application?.id ?? session.providerId;
    const tally = providers.get(markId) ?? {
      providerId: markId,
      provider: application?.name ?? session.provider,
      total: 0,
      attention: 0,
    };
    providers.set(markId, {
      ...tally,
      total: tally.total + 1,
      attention: tally.attention + (session.urgency === SESSION_URGENCY.ATTENTION ? 1 : 0),
    });
  }

  return {
    ...counts,
    attentionIds,
    total: sessions.length,
    providers: [...providers.values()],
  };
}
