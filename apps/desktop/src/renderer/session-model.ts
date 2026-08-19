import {
  ATTENTION_DISPOSITION,
  compareSessionsByUrgency,
  isProviderId,
  type NormalizedSession,
  PROVIDER_ID_LIST,
  type ProviderId,
  SESSION_LIST_SORT,
  SESSION_LOCATION,
  SESSION_STATUS,
  SESSION_URGENCY,
  type SessionControlKind,
  type SessionDiffSummary,
  type SessionListSort,
  type SessionLocation,
  type SessionNoticeAsk,
  type SessionUrgency,
  sessionChangeNumber,
  urgencyLabel,
} from "@sidecar/core";
import type { AppBootstrap } from "../shared/contracts";

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

/**
 * Reads a spoken filter into the list's own vocabulary. The values are the
 * same strings the chips use — the coarse scopes and the provider ids — so a
 * validated spoken ask maps one-to-one; anything else is nothing rather than
 // SAFETY: The preceding check establishes the asserted contract.
 * a guess, and the list is left as it was.
 */
export function sessionFilterFromSpoken(value: string): SessionFilter | undefined {
  if (
    value === SESSION_FILTER.ALL ||
    value === SESSION_FILTER.LOCAL ||
    value === SESSION_FILTER.CLOUD
  ) {
    return value;
  }
  return isProviderId(value) ? value : undefined;
}

/**
 * The two questions a list of agent sessions is read to answer. The set is
 * core's, because a spoken ask names an order in the same words this control
 * does and the two must not drift into separate vocabularies.
 */
export const SESSION_SORT = SESSION_LIST_SORT;

export type SessionSort = SessionListSort;

export interface SessionView {
  filter: SessionFilter;
  sort: SessionSort;
  /** The words the list is searched by; empty when nothing is being searched. */
  query: string;
}

/**
 * What the panel opens on, every time. A filter is not remembered across a
 * closing, because a remembered one could hide the very session the capsule is
 * reporting; the order is not remembered with it, so the top row keeps matching
 * the mark the capsule kept. A search is forgotten on the same terms — it is a
 // SAFETY: The preceding check establishes the asserted contract.
 * question about the list as it was, not a standing way of viewing it.
 */
export const DEFAULT_SESSION_VIEW: SessionView = {
  filter: SESSION_FILTER.ALL,
  sort: SESSION_SORT.URGENCY,
  query: "",
};

// SAFETY: The preceding check establishes the asserted contract.
/** One provider-advertised action, exactly as the adapter advertised it. */
export interface SessionAction {
  id: string;
  label: string;
  // SAFETY: The preceding check establishes the asserted contract.
  /** A stop is drawn as the stop glyph; anything else is drawn by its label. */
  kind?: SessionControlKind;
  /**
   * The provider-owned identifier of the thing the action acts on, when that
   * is not the session itself — carried through from the advertisement because
   * an action aimed at the row's whole workspace is drawn on the tray, not on
   * every chat inside it.
   */
  target?: string;
}

/**
 * The workspace a row's session is one chat of, when its provider nests them.
 * The id is what rows are grouped by — always beside the provider id, because
 * two providers' workspace ids share no namespace — and the name is what the
 * group is titled.
 */
export interface DisplayWorkspace {
  id: string;
  name: string;
}

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
  /**
   * The size of the session's change, already worded for the row — the counts
   * are the provider's, the words are the surface's. Beside the checkout on
   * the place line, because both say what the work touched.
   */
  diff?: string;
  urgency: SessionUrgency;
  label: string;
  location: SessionLocation;
  observedAt: number;
  /**
   * Whether the provider gave an address that opens this session, which is what
   * decides if the row is a control at all. The address itself stays in the
   * main process: the row only has to know that pressing it would do something.
   */
  openable: boolean;
  /**
   * Whether the provider will take a typed message for this session right now.
   * Like the address, the route stays in the main process; the row only has to
   * know whether to offer the field.
   */
  canMessage: boolean;
  /** Actions the provider advertised for this session, in its own words. */
  actions: readonly SessionAction[];
  /**
   * Whether the provider reported published work — a pull request — for this
   * session. Like the session's own address, the URL stays in the main
   * process; the row only has to know the chip would open something.
   */
  hasChange: boolean;
  /**
   * The pull request's own number, when the address's shape names one, so the
   * chip can say "#245" the way the host does. A number and never the address:
   * absent, the chip keeps the generic words rather than guessing.
   */
  changeNumber?: number;
  /**
   * The developer's standing ask about this session, when one stands, so the
   * row can mark that Luke is listening for it. The words are the developer's
   * own, drawn only on this machine.
   */
  noticeAsk?: string;
  /** The workspace this row is one chat of, when its provider nests them. */
  workspace?: DisplayWorkspace;
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

/** What became of the query, reported so no narrowing is ever silent. */
export interface SessionSearchOutcome {
  /** The query's words, lowercased — what each row was actually read against. */
  tokens: readonly string[];
  /** How many sessions the query was read against: the filtered set. */
  searched: number;
  /**
   * Sessions the query matches that the filter is hiding. The count is what
   * lets an emptied search offer the matches instead of implying there are
   * none anywhere.
   */
  beyondFilter: number;
}

export interface ArrangedSessions {
  /** The rows the list draws, narrowed and ordered. */
  sessions: readonly DisplaySession[];
  /** Everything tracked, which is what the controls are offered against. */
  total: number;
  /** The filter actually in force, which is All whenever the chosen one emptied. */
  filter: SessionFilter;
  options: readonly SessionFilterOption[];
  /** Present only while a query is in force. */
  search?: SessionSearchOutcome;
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
  /** The urgency the count badge and the notch capsule adopt. */
  urgency: SessionUrgency;
  /** One agent each, seated where its first session reads under the sort. */
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
 * The line under the title. What stopped a session outranks everything; while
 * the evaluator has flagged the session, its one-line reason outranks what the
 * session was doing — the row lit up for that reason, and a stale recap under
 * an attention colour says the wrong thing — and what a session was doing
 * outranks the recap of a turn that has already ended.
 *
 * When a provider reported none of them, the line says the state in so many
 * words. This sentence is the one place the row states it, so a session whose
 // SAFETY: The preceding check establishes the asserted contract.
 * provider said nothing still reads as Working or Complete rather than as a
 * row with a line missing.
 */
function sessionDetail(session: NormalizedSession, urgency: SessionUrgency): string {
  const flaggedSummary =
    session.attention.disposition === ATTENTION_DISPOSITION.SILENT
      ? undefined
      : session.attention.summary;
  return (
    session.detail.error ??
    flaggedSummary ??
    session.detail.activity ??
    session.recap ??
    urgencyLabel(urgency)
  );
}

/**
 * The size of a change in the words a row spends on it. The counts are the
 * provider's own; only the wording is the surface's, and the minus is the
 // SAFETY: The preceding check establishes the asserted contract.
 * real minus sign so the two figures read as a diff rather than arithmetic.
 */
export function sessionDiffLabel(diff: SessionDiffSummary): string {
  const files = `${diff.filesChanged} ${diff.filesChanged === 1 ? "file" : "files"}`;
  return `${files} +${diff.linesAdded} −${diff.linesRemoved}`;
}

/**
 * The standing asks by the identity each is about — nested maps rather than a
 * composed key — so each row can pick up the one ask that names it.
 */
function noticeAsksByIdentity(
  noticeAsks: readonly SessionNoticeAsk[],
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const byProvider = new Map<string, Map<string, string>>();
  for (const noticeAsk of noticeAsks) {
    const providerAsks = byProvider.get(noticeAsk.providerId) ?? new Map<string, string>();
    providerAsks.set(noticeAsk.providerSessionId, noticeAsk.ask);
    byProvider.set(noticeAsk.providerId, providerAsks);
  }
  return byProvider;
}

function sessionUrgency(session: NormalizedSession): SessionUrgency {
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
function searchTokens(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * The lines a query is read against: everything the row itself can say — its
 * title, the sentence under it, the branch and repository, the workspace it is
 * a chat of — plus identifiers the row does not always spend a line on: the
 * agent's name and its model, kept on the mark's hover, and a chat's own name,
 * which a lone chat cedes its title line to its workspace for. Those still
 * find the session — each is a name the provider's own surface knows it by —
 * so a row can match without a mark to show for it; the marks only ever land
 * on the lines the row draws.
 */
function searchableLines(session: DisplaySession): readonly string[] {
  const lines = [
    session.title,
    session.detail,
    session.branch,
    session.repository,
    session.workspace?.name,
    session.provider,
    session.model,
  ];
  return lines.filter((line): line is string => line !== undefined);
}

/** Every word somewhere on the row: words narrow, they never widen. */
function matchesQuery(session: DisplaySession, tokens: readonly string[]): boolean {
  const lines = searchableLines(session).map((line) => line.toLowerCase());
  return tokens.every((token) => lines.some((line) => line.includes(token)));
}

/** One stretch of a drawn line that a query's word landed on. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * Where a query's words sit in one drawn line, so the row can show why it
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

/** Most urgent first, and within one state the one that moved most recently. */
const byUrgency = compareSessionsByUrgency;

/** What moved last, with urgency deciding sessions observed in the same tick. */
function byRecency(first: DisplaySession, second: DisplaySession): number {
  return second.observedAt - first.observedAt || byUrgency(first, second);
}

/** The comparator a sort names — one answer for the list and the wing's marks. */
function bySort(sort: SessionSort): (first: DisplaySession, second: DisplaySession) => number {
  return sort === SESSION_SORT.RECENCY ? byRecency : byUrgency;
}

export function displaySessions(
  bootstrap: AppBootstrap,
  sessions: readonly NormalizedSession[],
  noticeAsks: readonly SessionNoticeAsk[] = [],
): readonly DisplaySession[] {
  const asks = noticeAsksByIdentity(noticeAsks);
  const visible: readonly DisplaySession[] = bootstrap.fixtureMode
    ? bootstrap.fixture.sessions.map((session) => ({
        ...session,
        // The same wording rule the live path applies: a fixture row whose
        // provider said nothing states its own state, so the evidence shows
        // the fallback rather than a gap.
        detail: session.detail || urgencyLabel(session.urgency),
        label: urgencyLabel(session.urgency),
        // A fixture stands for sessions that are not on the machine drawing
        // them, so there is nothing for a press to open. The composer and the
        // controls are still drawn where the fixture says a live session would
        // have them — the evidence has to show them — but a fixture run cannot
        // reach a provider: the main process refuses every write against its
        // empty registry.
        openable: false,
        canMessage: session.canMessage === true,
        actions: session.actions ?? [],
        hasChange: session.hasChange === true,
      }))
    : sessions.map((session) => {
        const urgency = sessionUrgency(session);
        const noticeAsk = asks.get(session.providerId)?.get(session.providerSessionId);
        const changeNumber = session.detail.change
          ? sessionChangeNumber(session.detail.change)
          : undefined;
        return {
          id: session.providerSessionId,
          title: session.title,
          providerId: session.providerId,
          provider: session.provider.displayName,
          detail: sessionDetail(session, urgency),
          repository: session.detail.repository,
          branch: session.detail.branch,
          model: session.detail.model,
          ...(session.detail.diff ? { diff: sessionDiffLabel(session.detail.diff) } : undefined),
          urgency,
          label: urgencyLabel(urgency),
          location: session.location,
          observedAt: session.observedAt,
          openable: session.detail.link !== undefined,
          canMessage: session.canReceiveMessage,
          actions: session.controls,
          hasChange: session.detail.change !== undefined,
          ...(changeNumber !== undefined ? { changeNumber } : undefined),
          ...(noticeAsk ? { noticeAsk } : undefined),
          // A workspace the provider left unnamed still groups its chats; the
          // id is at least stable, where a made-up name would claim knowledge
          // the provider never reported.
          ...(session.workspace
            ? {
                workspace: {
                  id: session.workspace.providerWorkspaceId,
                  name: session.workspace.name ?? session.workspace.providerWorkspaceId,
                },
              }
            : undefined),
        };
      });

  return [...visible].sort(byUrgency);
}

const LOCATION_LABEL = {
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

/** Whether two rows are chats of one workspace. The provider id rides the
 * comparison because two providers' workspace ids share no namespace. */
function sameWorkspace(first: DisplaySession, second: DisplaySession): boolean {
  return (
    first.workspace !== undefined &&
    second.workspace !== undefined &&
    first.providerId === second.providerId &&
    first.workspace.id === second.workspace.id
  );
}

/**
 * Seats every workspace's chats together without disturbing what the sort
 * decided: a workspace sits where its best-read chat sorted, and its other
 // SAFETY: The preceding check establishes the asserted contract.
 * chats follow in their own sorted order, so the group is exactly as urgent —
 // SAFETY: The preceding check establishes the asserted contract.
 * or as recent — as the chat that earned its seat. Ungrouped sessions keep
 * their seats, and a group whose sibling would have sat between two strangers
 * simply closes the gap.
 */
function seatWorkspacesTogether(sessions: readonly DisplaySession[]): readonly DisplaySession[] {
  const seated: DisplaySession[] = [];
  const taken = new Set<string>();
  for (const session of sessions) {
    if (taken.has(session.id)) continue;
    taken.add(session.id);
    seated.push(session);
    if (!session.workspace) continue;
    for (const sibling of sessions) {
      if (taken.has(sibling.id) || !sameWorkspace(session, sibling)) continue;
      taken.add(sibling.id);
      seated.push(sibling);
    }
  }
  return seated;
}

/**
 * One stretch of the drawn list: a workspace's adjacent chats — the tray the
 * panel draws around them, named once at its top — or a single ungrouped
 // SAFETY: The preceding check establishes the asserted contract.
 * session. Runs are read off the arranged order rather than kept as state, so
 * a re-sort that reseats a workspace can never leave a stale tray behind.
 */
export interface SessionListRun {
  /** The tray's workspace; absent for a session no provider grouped. */
  workspace?: DisplayWorkspace;
  /** The checkout the tray's chats work in, when any of them reported one. */
  repository?: string;
  /** Indexes into the arranged list, adjacent and in order. */
  indexes: readonly number[];
}

/**
 * One React key per run. A workspace run is keyed by the workspace so that a
 * tray crossing between one chat and several keeps the same wrapper — and the
 * rows inside it, and their half-typed drafts — mounted. But a workspace can
 * briefly hold two runs at once: a chat fading out of a narrowed list keeps
 * the slot it was seen in, and a stranger's slot between it and its living
 * siblings splits the workspace in two. Two wrappers sharing a key would make
 * React track one and abandon the other's DOM — a blank row left in the list —
 * so the workspace's key belongs to one run at a time: the first with a
 * living row, whose drafts are the thing worth keeping, or the first outright
 * while every chat is leaving, so an undisturbed fade keeps its wrapper. Any
 * other run of that workspace is keyed by its lead session instead.
 */
export function sessionRunKeys(
  runs: readonly SessionListRun[],
  rows: readonly { item: { id: string }; leaving: boolean }[],
): readonly string[] {
  const owner = new Map<string, { at: number; living: boolean }>();
  runs.forEach((run, at) => {
    if (!run.workspace) return;
    const living = run.indexes.some((index) => rows[index]?.leaving === false);
    const held = owner.get(run.workspace.id);
    if (held === undefined || (living && !held.living)) {
      owner.set(run.workspace.id, { at, living });
    }
  });
  return runs.map((run, at) => {
    if (run.workspace && owner.get(run.workspace.id)?.at === at) return run.workspace.id;
    const lead = run.indexes[0];
    return (lead !== undefined ? rows[lead]?.item.id : undefined) ?? "";
  });
}

/**
 * Whether an advertised action acts on the row's whole workspace rather than
 * on the chat itself — a Conductor archive, whose target is the workspace id
 * riding the advertisement. Only the target can say so: the label is the
 * provider's own words, and words are not a contract.
 */
export function actsOnWorkspace(session: DisplaySession, action: SessionAction): boolean {
  return session.workspace !== undefined && action.target === session.workspace.id;
}

/** One workspace-level act, and the chat whose advertisement carries it. */
export interface WorkspaceTrayAction {
  action: SessionAction;
  session: DisplaySession;
}

/**
 * The acts a tray's header offers: every workspace-level action its chats
 * advertise, each once. A provider advertises the same archive on every chat
 * of a settled workspace, and a tray drawing one chip per chat reads as
 * several different acts when pressing any of them files the whole workspace
 * away — so the tray says it once, where the workspace is named once. The
 * first chat advertising an act is the one the press travels through, which
 * keeps the write validated against the same roster row that advertised it.
 */
export function workspaceTrayActions(
  sessions: readonly DisplaySession[],
): readonly WorkspaceTrayAction[] {
  const acts = new Map<string, WorkspaceTrayAction>();
  for (const session of sessions) {
    for (const action of session.actions) {
      if (!actsOnWorkspace(session, action) || acts.has(action.id)) continue;
      acts.set(action.id, { action, session });
    }
  }
  return [...acts.values()];
}

export function sessionListRuns(sessions: readonly DisplaySession[]): readonly SessionListRun[] {
  const runs: SessionListRun[] = [];
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (!session) continue;
    const previous = index > 0 ? sessions[index - 1] : undefined;
    const held = runs.at(-1);
    if (held?.workspace && previous && sameWorkspace(session, previous)) {
      const repository = held.repository ?? session.repository;
      runs[runs.length - 1] = {
        ...held,
        ...(repository ? { repository } : undefined),
        indexes: [...held.indexes, index],
      };
      continue;
    }
    runs.push({
      ...(session.workspace ? { workspace: session.workspace } : undefined),
      ...(session.workspace && session.repository ? { repository: session.repository } : undefined),
      indexes: [index],
    });
  }
  return runs;
}

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * The list as it is drawn. A chosen filter whose last session has since left —
 * an agent's only session finished, say — falls back to All rather than leaving
 * an empty panel, because the one thing this list may never do is hide a
 * session the capsule is still counting.
 *
 * Showing something is the whole of the test: a filter still matching sessions
 * survives even while no chip offers it, which happens when a spoken ask names
 * the only provider or location there is. Collapsing it then would be quietly
 * wrong twice over — Luke has just said the list was narrowed, and the moment
 * a second agent appeared the list would widen out from under a developer who
 * asked to watch one. While the filter is chipless it hides nothing (every
 // SAFETY: The preceding check establishes the asserted contract.
 * session matches), and as soon as another value exists its chip and the
 * options button's "showing X only" badge both appear.
 *
 * A query is the one narrowing allowed to empty the list, because it is a
 * question rather than a way of viewing: "nothing matches" is its honest
 * answer, where a filter falling to nothing is a stale choice to be dropped.
 * It reads within the filter — search narrows what is being shown — and what
 * the filter hides is counted rather than swallowed, so an emptied search can
 * offer the matches sitting behind the chip instead of denying they exist.
 */
export function arrangeSessions(
  sessions: readonly DisplaySession[],
  view: SessionView,
): ArrangedSessions {
  const options = filterOptions(sessions);
  const chosen =
    view.filter === SESSION_FILTER.ALL
      ? sessions
      : sessions.filter((session) => matchesFilter(session, view.filter));
  const filter = chosen.length > 0 ? view.filter : SESSION_FILTER.ALL;
  const matching = filter === view.filter ? chosen : sessions;

  const tokens = searchTokens(view.query);
  const found =
    tokens.length === 0 ? matching : matching.filter((session) => matchesQuery(session, tokens));
  const search: SessionSearchOutcome | undefined =
    tokens.length === 0
      ? undefined
      : {
          tokens,
          searched: matching.length,
          beyondFilter:
            matching.length === sessions.length
              ? 0
              : sessions.filter(
                  (session) => !matchesFilter(session, filter) && matchesQuery(session, tokens),
                ).length,
        };

  return {
    sessions: seatWorkspacesTogether([...found].sort(bySort(view.sort))),
    total: sessions.length,
    filter,
    options,
    ...(search ? { search } : undefined),
  };
}

/**
 * Counted across everything tracked, whatever the list is narrowed to — but
 * read in the sort the list is read in, so the providers sit in the order
 * their first sessions do and the wing's marks match the rows. With no view in
 * force — the capsule, say — the sessions read by urgency, which is also the
 * sort the panel opens on.
 */
export function sessionTally(
  sessions: readonly DisplaySession[],
  sort: SessionSort = SESSION_SORT.URGENCY,
): SessionTally {
  const providers = new Map<string, ProviderTally>();
  const counts = { attention: 0, working: 0, complete: 0, idle: 0 };
  const attentionIds: string[] = [];

  for (const session of [...sessions].sort(bySort(sort))) {
    if (session.urgency === SESSION_URGENCY.ATTENTION) {
      counts.attention += 1;
      attentionIds.push(session.id);
    } else if (session.urgency === SESSION_URGENCY.WORKING) counts.working += 1;
    else if (session.urgency === SESSION_URGENCY.COMPLETE) counts.complete += 1;
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
      attention: tally.attention + (session.urgency === SESSION_URGENCY.ATTENTION ? 1 : 0),
    });
  }

  return {
    ...counts,
    attentionIds,
    total: sessions.length,
    urgency: dominantUrgency(counts),
    providers: [...providers.values()],
  };
}

function dominantUrgency(counts: {
  attention: number;
  working: number;
  complete: number;
}): SessionUrgency {
  if (counts.attention > 0) return SESSION_URGENCY.ATTENTION;
  if (counts.working > 0) return SESSION_URGENCY.WORKING;
  if (counts.complete > 0) return SESSION_URGENCY.COMPLETE;
  return SESSION_URGENCY.UNKNOWN;
}

/**
 * The number the badge draws: the count of the state its colour names, so the
 * numeral and the tint state one fact. A "12" that meant "12 tracked" while
 * its colour meant "something needs you" made the reader hold two channels
 * apart; here an attention-coloured 2 is 2 sessions needing you. The total
 * only stands in when nothing is live enough to colour, because "how many
 * need me" and "how many are working" are the questions the badge exists to
 * answer, and the total answers neither.
 */
export function tallyValue(tally: SessionTally): number {
  switch (tally.urgency) {
    case SESSION_URGENCY.ATTENTION:
      return tally.attention;
    case SESSION_URGENCY.WORKING:
      return tally.working;
    case SESSION_URGENCY.COMPLETE:
      return tally.complete;
    default:
      return tally.total;
  }
}

/** One sentence that reads correctly for a screen reader in either mode. */
export function tallySummary(tally: SessionTally): string {
  if (tally.total === 0) return "No sessions tracked";
  if (tally.attention > 0) {
    return `${tally.attention} ${tally.attention === 1 ? "session needs" : "sessions need"} you`;
  }
  if (tally.working > 0) {
    return `${tally.working} ${tally.working === 1 ? "session" : "sessions"} working`;
  }
  if (tally.complete > 0) {
    return `${tally.complete} ${tally.complete === 1 ? "session" : "sessions"} complete`;
  }
  return `${tally.total} ${tally.total === 1 ? "session" : "sessions"} tracked`;
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
 * The caption beside the count once the panel has room for it. The badge's
 * number is the count of the state its colour names, so the caption is only
 * that state's words — never a number of its own, which would stand two
 * numerals with different denominators side by side.
 */
export function tallyCaption(tally: SessionTally): string {
  if (tally.total === 0) return "none tracked";
  if (tally.attention > 0) return tally.attention === 1 ? "needs you" : "need you";
  if (tally.working > 0) return "working";
  if (tally.complete > 0) return "complete";
  return "tracked";
}
