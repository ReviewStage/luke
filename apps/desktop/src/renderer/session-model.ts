import {
  ATTENTION_DISPOSITION,
  isProviderId,
  type NormalizedSession,
  PROVIDER_ID_LIST,
  type ProviderId,
  SESSION_LOCATION,
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

/** The state order the surface reads top-down and the badge collapses to. */
const STATE_PRIORITY: readonly SessionState[] = [
  SESSION_STATE.ATTENTION,
  SESSION_STATE.WORKING,
  SESSION_STATE.COMPLETE,
  SESSION_STATE.UNKNOWN,
];

/**
 * Which sessions the list draws: everything, everything running in one place,
 * or everything belonging to one agent. The two coarse values are the session
 * locations themselves and the rest are provider ids, so narrowing the list is
 * a comparison against something a row already carries rather than a second
 * vocabulary mapped onto it. The two sets cannot collide — no provider is
 * called `local` or `cloud`.
 *
 * Location belongs to the session rather than to the agent, so an agent with
 * work in both places is one chip that answers `Local` and `Cloud` both.
 */
export const SESSION_FILTER = {
  ALL: "all",
  LOCAL: SESSION_LOCATION.LOCAL,
  CLOUD: SESSION_LOCATION.CLOUD,
} as const;

export type SessionFilter = (typeof SESSION_FILTER)[keyof typeof SESSION_FILTER] | ProviderId;

function matchesFilter(session: DisplaySession, filter: SessionFilter): boolean {
  if (filter === SESSION_FILTER.ALL) return true;
  if (filter === SESSION_FILTER.LOCAL || filter === SESSION_FILTER.CLOUD) {
    return session.location === filter;
  }
  return session.providerId === filter;
}

/** The two questions a list of agent sessions is read to answer. */
export const SESSION_SORT = {
  URGENCY: "urgency",
  RECENCY: "recency",
} as const;

export type SessionSort = (typeof SESSION_SORT)[keyof typeof SESSION_SORT];

export interface SessionView {
  filter: SessionFilter;
  sort: SessionSort;
}

/**
 * What the panel opens on, every time. A filter is not remembered across a
 * closing, because a remembered one could hide the very session the capsule is
 * reporting; the order is not remembered with it, so the top row keeps matching
 * the mark the capsule kept.
 */
export const DEFAULT_SESSION_VIEW: SessionView = {
  filter: SESSION_FILTER.ALL,
  sort: SESSION_SORT.URGENCY,
};

export interface DisplaySession {
  id: string;
  title: string;
  providerId: string;
  provider: string;
  /** What the session is doing, or what stopped it, worded to carry the state. */
  detail: string;
  /**
   * Which checkout the work is in. Two fields rather than one line, because the
   * row draws a branch under its own glyph and a repository plain, and only the
   * fields can say which kind of identifier this is.
   */
  repository?: string;
  branch?: string;
  /** Read on the provider mark's hover, never spent on a line of the row. */
  model?: string;
  state: SessionState;
  label: string;
  location: SessionLocation;
  observedAt: number;
  /**
   * Whether the provider gave an address that opens this session, which is what
   * decides if the row is a control at all. The address itself stays in the
   * main process: the row only has to know that pressing it would do something.
   */
  openable: boolean;
}

/** One filter someone can choose, and how many sessions it would leave. */
export interface SessionFilterOption {
  filter: SessionFilter;
  label: string;
  count: number;
  /**
   * Set when the chip stands for one agent, so the row can draw that agent's
   * own mark where the coarser chips carry a word.
   */
  providerId?: string;
}

export interface ArrangedSessions {
  /** The rows the list draws, narrowed and ordered. */
  sessions: readonly DisplaySession[];
  /** Everything tracked, which is what the controls are offered against. */
  total: number;
  /** The filter actually in force, which is All whenever the chosen one emptied. */
  filter: SessionFilter;
  options: readonly SessionFilterOption[];
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
   * same poll and it never moves. Luke's face reacts to the event and the badge
   * reports the count, so the tally has to carry both.
   */
  attentionIds: readonly string[];
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
 * When a provider reported none of them, the line says the state in so many
 * words. This sentence is the one place the row states it — there is no chip at
 * the other end any more — so a session whose provider said nothing still reads
 * as Working or Complete rather than as a row with a line missing.
 */
function sessionDetail(session: NormalizedSession, state: SessionState): string {
  return session.detail.error ?? session.detail.activity ?? session.summary ?? STATE_LABEL[state];
}

function sessionState(session: NormalizedSession): SessionState {
  if (sessionNeedsAttention(session)) return SESSION_STATE.ATTENTION;
  if (session.status === SESSION_STATUS.COMPLETE) return SESSION_STATE.COMPLETE;
  if (session.status === SESSION_STATUS.UNKNOWN) return SESSION_STATE.UNKNOWN;
  return SESSION_STATE.WORKING;
}

/** Most urgent first, and within one state the one that moved most recently. */
function byUrgency(first: DisplaySession, second: DisplaySession): number {
  return (
    STATE_PRIORITY.indexOf(first.state) - STATE_PRIORITY.indexOf(second.state) ||
    second.observedAt - first.observedAt
  );
}

/** What moved last, with urgency deciding sessions observed in the same tick. */
function byRecency(first: DisplaySession, second: DisplaySession): number {
  return second.observedAt - first.observedAt || byUrgency(first, second);
}

export function displaySessions(
  bootstrap: AppBootstrap,
  sessions: readonly NormalizedSession[],
): readonly DisplaySession[] {
  const visible: readonly DisplaySession[] = bootstrap.fixtureMode
    ? bootstrap.fixture.sessions.map((session) => ({
        ...session,
        // The same wording rule the live path applies: a fixture row whose
        // provider said nothing states its own state, so the evidence shows
        // the fallback rather than a gap.
        detail: session.detail || STATE_LABEL[session.state],
        label: STATE_LABEL[session.state],
        // A fixture stands for sessions that are not on the machine drawing
        // them, so there is nothing for a press to open. Nothing is lost from
        // the visual evidence by that: a row that can be opened and one that
        // cannot are drawn alike until a pointer is over one.
        openable: false,
      }))
    : sessions.map((session) => {
        const state = sessionState(session);
        return {
          id: session.providerSessionId,
          title: session.title,
          providerId: session.providerId,
          provider: session.provider.displayName,
          detail: sessionDetail(session, state),
          repository: session.detail.repository,
          branch: session.detail.branch,
          model: session.detail.model,
          state,
          label: STATE_LABEL[state],
          location: session.location,
          observedAt: session.observedAt,
          openable: session.detail.link !== undefined,
        };
      });

  return [...visible].sort(byUrgency);
}

const LOCATION_LABEL: Record<SessionLocation, string> = {
  [SESSION_LOCATION.LOCAL]: "Local",
  [SESSION_LOCATION.CLOUD]: "Cloud",
};

/** The order the location chips read in: what runs here, then what runs away. */
const LOCATION_ORDER: readonly SessionLocation[] = [SESSION_LOCATION.LOCAL, SESSION_LOCATION.CLOUD];

/**
 * All, then where a session runs, then which agent is running it — coarse to
 * fine, left to right. Each level is offered only where it is a real choice: a
 * single location says nothing All has not already said, and neither does a
 * single agent. The counts make the row a breakdown of what is tracked before
 * it is a control, which is what earns it the line it costs.
 *
 * Agents are listed in the registry's own order rather than by how many
 * sessions they have, so a chip never moves out from under the pointer as
 * sessions come and go.
 */
function filterOptions(sessions: readonly DisplaySession[]): readonly SessionFilterOption[] {
  if (sessions.length === 0) return [];

  const locations = new Map<SessionLocation, number>();
  const providers = new Map<ProviderId, { label: string; count: number }>();
  for (const session of sessions) {
    locations.set(session.location, (locations.get(session.location) ?? 0) + 1);
    // An agent this build has no registry entry for has no mark to draw a chip
    // with, so it is counted under All and offered under nothing else.
    if (!isProviderId(session.providerId)) continue;
    const tally = providers.get(session.providerId);
    providers.set(session.providerId, {
      label: session.provider,
      count: (tally?.count ?? 0) + 1,
    });
  }

  const locationOptions =
    locations.size > 1
      ? LOCATION_ORDER.filter((location) => locations.has(location)).map((location) => ({
          filter: location,
          label: LOCATION_LABEL[location],
          count: locations.get(location) ?? 0,
        }))
      : [];
  const providerOptions =
    providers.size > 1
      ? PROVIDER_ID_LIST.filter((providerId) => providers.has(providerId)).map((providerId) => ({
          filter: providerId,
          label: providers.get(providerId)?.label ?? providerId,
          count: providers.get(providerId)?.count ?? 0,
          providerId,
        }))
      : [];

  return [
    { filter: SESSION_FILTER.ALL, label: "All", count: sessions.length },
    ...locationOptions,
    ...providerOptions,
  ];
}

/**
 * The list as it is drawn. A chosen filter whose last session has since left —
 * an agent's only session finished, say — falls back to All rather than leaving
 * an empty panel, because the one thing this list may never do is hide a
 * session the capsule is still counting.
 */
export function arrangeSessions(
  sessions: readonly DisplaySession[],
  view: SessionView,
): ArrangedSessions {
  const options = filterOptions(sessions);
  const filter = options.some((option) => option.filter === view.filter)
    ? view.filter
    : SESSION_FILTER.ALL;
  const matching =
    filter === SESSION_FILTER.ALL
      ? sessions
      : sessions.filter((session) => matchesFilter(session, filter));

  return {
    sessions: [...matching].sort(view.sort === SESSION_SORT.RECENCY ? byRecency : byUrgency),
    total: sessions.length,
    filter,
    options,
  };
}

export function sessionTally(sessions: readonly DisplaySession[]): SessionTally {
  const providers = new Map<string, ProviderTally>();
  const counts = { attention: 0, working: 0, complete: 0, idle: 0 };
  const attentionIds: string[] = [];

  for (const session of sessions) {
    if (session.state === SESSION_STATE.ATTENTION) {
      counts.attention += 1;
      attentionIds.push(session.id);
    } else if (session.state === SESSION_STATE.WORKING) counts.working += 1;
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
    attentionIds,
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
 * How long ago a session was last seen, in the coarsest unit that has begun,
 * because the label answers "is this thing alive" rather than telling time.
 * Single-letter units, the way Mail and Messages abbreviate: the label is
 * consulted, not read, and "23m" against the row's edge says everything
 * "23 min" did. Anything under a minute is "Now" — and so is a timestamp ahead
 * of the clock, which a provider's clock skew can produce and a negative age
 * would only dramatize. `now` is an argument rather than a clock read here:
 * fixture rows are measured against the fixture's own epoch so the evidence
 * stays reproducible, and live rows against whatever render tick asked.
 */
export function observedAgoLabel(observedAt: number, now: number): string {
  const elapsedMinutes = Math.floor((now - observedAt) / 60_000);
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
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
