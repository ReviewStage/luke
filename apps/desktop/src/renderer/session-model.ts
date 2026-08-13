import {
  ATTENTION_DISPOSITION,
  isProviderId,
  type NormalizedSession,
  PROVIDER_ID_LIST,
  PROVIDER_ORIGIN,
  type ProviderId,
  type ProviderOrigin,
  providerOrigin,
  SESSION_STATE,
  SESSION_STATUS,
  type SessionState,
} from "@sidecar/core";
import type { AppBootstrap } from "../shared/contracts";

export const STATE_LABEL: Record<SessionState, string> = {
  [SESSION_STATE.WORKING]: "Working",
  [SESSION_STATE.ATTENTION]: "Needs you",
  [SESSION_STATE.COMPLETE]: "Complete",
  [SESSION_STATE.UNKNOWN]: "Idle",
};

const STATUS_LABEL: Record<NormalizedSession["status"], string> = {
  [SESSION_STATUS.WORKING]: "Working",
  [SESSION_STATUS.WAITING]: "Waiting",
  [SESSION_STATUS.COMPLETE]: "Complete",
  [SESSION_STATUS.UNKNOWN]: "Observed",
};

/** The state order the surface reads top-down and the badge collapses to. */
const STATE_PRIORITY: readonly SessionState[] = [
  SESSION_STATE.ATTENTION,
  SESSION_STATE.WORKING,
  SESSION_STATE.COMPLETE,
  SESSION_STATE.UNKNOWN,
];

/**
 * Which sessions the list draws: everything, one kind of agent, or one agent.
 * The two coarse values are the origins themselves and the rest are provider
 * ids, so narrowing the list is a comparison against something a row already
 * carries rather than a second vocabulary mapped onto it. The two sets cannot
 * collide — no provider is called `local` or `cloud`.
 */
export const SESSION_FILTER = {
  ALL: "all",
  LOCAL: PROVIDER_ORIGIN.LOCAL,
  CLOUD: PROVIDER_ORIGIN.CLOUD,
} as const;

export type SessionFilter = (typeof SESSION_FILTER)[keyof typeof SESSION_FILTER] | ProviderId;

function matchesFilter(session: DisplaySession, filter: SessionFilter): boolean {
  if (filter === SESSION_FILTER.ALL) return true;
  if (filter === SESSION_FILTER.LOCAL || filter === SESSION_FILTER.CLOUD) {
    return session.origin === filter;
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
  detail: string;
  state: SessionState;
  label: string;
  observedAt: number;
  /** Undefined for a provider this build has no registry entry for. */
  origin?: ProviderOrigin;
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
    session.attention.disposition !== ATTENTION_DISPOSITION.SILENT
  );
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
        label: STATE_LABEL[session.state],
        origin: providerOrigin(session.providerId),
      }))
    : sessions.map((session) => ({
        id: session.providerSessionId,
        title: session.title,
        providerId: session.providerId,
        provider: session.provider.displayName,
        detail: session.summary ?? STATUS_LABEL[session.status],
        state: sessionState(session),
        label: STATE_LABEL[sessionState(session)],
        observedAt: session.observedAt,
        // Where a session runs is a fact about its provider, so it is read from
        // the registry rather than reported per session by an adapter.
        origin: providerOrigin(session.providerId),
      }));

  return [...visible].sort(byUrgency);
}

const ORIGIN_LABEL: Record<ProviderOrigin, string> = {
  [PROVIDER_ORIGIN.LOCAL]: "Local",
  [PROVIDER_ORIGIN.CLOUD]: "Cloud",
};

/** The order the origin chips read in: what runs here, then what runs away. */
const ORIGIN_ORDER: readonly ProviderOrigin[] = [PROVIDER_ORIGIN.LOCAL, PROVIDER_ORIGIN.CLOUD];

/**
 * All, then where a session runs, then which agent is running it — coarse to
 * fine, left to right. Each level is offered only where it is a real choice: a
 * single kind of origin says nothing All has not already said, and neither does
 * a single agent. The counts make the row a breakdown of what is tracked before
 * it is a control, which is what earns it the line it costs.
 *
 * Agents are listed in the registry's own order rather than by how many
 * sessions they have, so a chip never moves out from under the pointer as
 * sessions come and go.
 */
function filterOptions(sessions: readonly DisplaySession[]): readonly SessionFilterOption[] {
  if (sessions.length === 0) return [];

  const origins = new Map<ProviderOrigin, number>();
  const providers = new Map<ProviderId, { label: string; count: number }>();
  for (const session of sessions) {
    if (session.origin) origins.set(session.origin, (origins.get(session.origin) ?? 0) + 1);
    // A provider with no registry entry is counted under All and nowhere else,
    // rather than being filed under a guess about where it runs.
    if (!isProviderId(session.providerId)) continue;
    const tally = providers.get(session.providerId);
    providers.set(session.providerId, {
      label: session.provider,
      count: (tally?.count ?? 0) + 1,
    });
  }

  const originOptions =
    origins.size > 1
      ? ORIGIN_ORDER.filter((origin) => origins.has(origin)).map((origin) => ({
          filter: origin,
          label: ORIGIN_LABEL[origin],
          count: origins.get(origin) ?? 0,
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
    ...originOptions,
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
