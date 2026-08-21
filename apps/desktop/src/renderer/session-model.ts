import type { SessionNoticeAsk } from "@sidecar/attention";
import type { SessionSnapshot } from "@sidecar/fixtures";
import { SESSION_LIST_SORT, type SessionListSort } from "@sidecar/guide";
import type { IssueIdentity } from "@sidecar/issues";
import { SESSION_LIST_ALL } from "@sidecar/realtime";
import {
  ATTENTION_DISPOSITION,
  HOSTED_AGENT_ID_LIST,
  type HostedAgentId,
  isHostedAgentId,
  isProviderId,
  isSessionApplicationId,
  matchesFilterSelection,
  mentionedSessions,
  type NormalizedSession,
  PROVIDER_ID_LIST,
  type ProviderId,
  SESSION_APPLICATION_ID_LIST,
  SESSION_FILTER,
  SESSION_FILTER_AXIS,
  SESSION_LOCATION,
  SESSION_MENTION_KIND,
  SESSION_STATUS,
  type SessionApplicationId,
  type SessionApplicationScope,
  type SessionControlKind,
  type SessionDiffSummary,
  type SessionFilter,
  type SessionFilterAxis,
  type SessionIdentity,
  type SessionLocation,
  sessionChangeNumber,
  sessionFilterAxis,
} from "@sidecar/session";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/superset/vocabulary";
import {
  compareSessionsByUrgency,
  SESSION_URGENCY,
  type SessionUrgency,
  urgencyLabel,
} from "@sidecar/surface";
import type { AppBootstrap } from "#shared/contracts";

/**
 * The narrowings and their vocabulary live in core so the stored selection is
 * validated by the same set the chips draw from. What a chip answers stays a
 * surface fact: location belongs to the session rather than to the agent, so
 * an agent with work in both places is one chip that answers `Local` and
 * `Cloud` both — and Superset belongs to the workspace rather than to the
 * agent, so the same agent answers its own chip and the Superset chip when
 * Superset manages it. A hosted chat carries its agent's identity beside its
 * provider's, so a Claude conversation in Conductor's cloud answers the
 * Claude Code chip and the Conductor chip at once.
 *
 * The axes the filters combine on live there too, because a spoken ask's
 * combination is validated against the observed roster by the same rules the
 * chips narrow the drawn list by, and the two readings must not drift apart.
 */
export {
  SESSION_FILTER,
  SESSION_FILTER_AXIS,
  type SessionFilter,
  type SessionFilterAxis,
  sessionFilterAxis,
};

function matchesFilter(session: DisplaySession, filter: SessionFilter): boolean {
  if (filter === SESSION_FILTER.LOCAL || filter === SESSION_FILTER.CLOUD) {
    return session.location === filter;
  }
  if (filter === SESSION_FILTER.VOICE) return session.realtimeVoice === true;
  return (
    session.providerId === filter ||
    session.agentId === filter ||
    session.workspace?.scopeId === filter ||
    session.applications.some((application) => application.id === filter)
  );
}

/** Whether a row answers the whole selection, on the axes' own combining rules. */
export function matchesSessionFilters(
  session: DisplaySession,
  filters: readonly SessionFilter[],
): boolean {
  return matchesFilterSelection(filters, (filter) => matchesFilter(session, filter));
}

/**
 * One filter chosen where one already stands: the same value leaves the
 * selection, a new one joins it. What a chip press means, kept beside the
 * matching so the two cannot drift.
 */
export function toggledSessionFilters(
  filters: readonly SessionFilter[],
  filter: SessionFilter,
): readonly SessionFilter[] {
  return filters.includes(filter)
    ? filters.filter((held) => held !== filter)
    : [...filters, filter];
}

/** Whether two selections narrow identically; a selection never repeats a value. */
export function sameSessionFilters(
  first: readonly SessionFilter[],
  second: readonly SessionFilter[],
): boolean {
  return first.length === second.length && first.every((filter) => second.includes(filter));
}

/** One spoken value read as the chip it names, or nothing when no chip holds it. */
function sessionFilterFromSpoken(value: string): SessionFilter | undefined {
  if (
    value === SESSION_FILTER.LOCAL ||
    value === SESSION_FILTER.CLOUD ||
    value === SESSION_FILTER.VOICE
  ) {
    return value;
  }
  if (isSessionApplicationId(value)) return value;
  return isProviderId(value) ? value : undefined;
}

/**
 * Reads a spoken narrowing into the list's own selection. The values are the
 * same strings the chips use — the coarse scopes, voice kind, app ids, and
 * provider ids — so a validated spoken ask maps one-to-one, and several
 * values combine exactly as the matching chips would. A spoken ask says what
 * the list should show, so it replaces a hand-picked combination rather than
 * joining it: `all` is the empty selection. A value no chip of this build
 * holds makes the whole ask nothing rather than a guess — a selection quietly
 * missing one of its values would show more than the ask named while
 * reporting the narrowing happened.
 */
export function sessionFiltersFromSpoken(
  values: readonly string[],
): readonly SessionFilter[] | undefined {
  if (values.length === 1 && values[0] === SESSION_LIST_ALL) return [];
  const selection: SessionFilter[] = [];
  for (const value of values) {
    const filter = sessionFilterFromSpoken(value);
    if (filter === undefined) return undefined;
    if (!selection.includes(filter)) selection.push(filter);
  }
  return selection;
}

/** What a spoken search is told it did: the count, and the honest word for a zero. */
export interface SpokenSearchOutcome {
  matches: number;
  note?: string;
}

/**
 * What a spoken search is told it did, read against the same arrangement the
 * panel is about to draw. A spoken filter that would show nothing is refused
 * before it is carried, but an emptied search is the list's honest answer
 * rather than a stale choice — so the outcome carries the count instead of a
 * refusal, and names the matches a filter is hiding the way the list's own
 * empty state does, so the sentence Luke says can never claim rows the list
 * will not draw.
 */
export function spokenSearchOutcome(
  sessions: readonly DisplaySession[],
  view: SessionView,
): SpokenSearchOutcome {
  const list = arrangeSessions(sessions, view);
  const matches = list.sessions.length;
  if (matches > 0) return { matches };
  const beyond = list.search?.beyondFilter ?? 0;
  if (beyond === 0) return { matches, note: "No sessions match those words." };
  return {
    matches,
    note: `No shown sessions match, but the filter in force hides ${beyond} ${
      beyond === 1 ? "session" : "sessions"
    } that would.`,
  };
}

/**
 * The two questions a list of agent sessions is read to answer. The set is
 * core's, because a spoken ask names an order in the same words this control
 * does and the two must not drift into separate vocabularies.
 */
export const SESSION_SORT = SESSION_LIST_SORT;

export type SessionSort = SessionListSort;

export interface SessionView {
  /** The chosen narrowings, combined by axis; empty shows every session. */
  filters: readonly SessionFilter[];
  sort: SessionSort;
  /** The words the list is searched by; empty when nothing is being searched. */
  query: string;
}

/**
 * What the panel opens on before any stored view arrives. The filters and the
 * search are the parts of the view that outlive a closing: each is a standing
 * way of viewing the list, restored from the stored settings at launch and
 * kept across capsule closings — and the capsule stays honest over both
 * because its tally is taken before the list is narrowed. A restored search
 * brings its field back open, so the narrowing is never in force behind no
 * visible control, and clearing or closing the field is what lets it go. The
 * order alone is not remembered, so the top row keeps matching the mark the
 * capsule kept.
 */
export const DEFAULT_SESSION_VIEW: SessionView = {
  filters: [],
  sort: SESSION_SORT.URGENCY,
  query: "",
};

/** One provider-advertised action, exactly as the adapter advertised it. */
export interface SessionAction {
  id: string;
  label: string;
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
  scopeId?: string;
  managerName?: string;
  name: string;
}

/** One app that independently associates itself with the session. */
export interface DisplayApplication {
  id: string;
  name: string;
  scope: SessionApplicationScope;
  /** Whether this app association carries its own exact normalized address. */
  openable: boolean;
}

export interface DisplaySession {
  id: string;
  title: string;
  providerId: string;
  provider: string;
  /**
   * The agent behind the chat, when its provider hosts agents rather than
   * being one — what the row's mark draws, so a Conductor cloud chat leads
   * with the agent having the conversation the way a local chat does.
   */
  agentId?: string;
  agent?: string;
  applications: readonly DisplayApplication[];
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
  /** Whether this is a realtime voice/delegation chat. */
  realtimeVoice?: boolean;
  observedAt: number;
  /**
   * Whether the provider gave an address that opens this session, which is what
   * decides if the row is a control at all. The address itself stays in the
   * main process: the row only has to know that pressing it would do something.
   */
  openable: boolean;
  /** The app owning the row's primary address, when that association is exact. */
  openApplication?: string;
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

/** One filter someone can choose, and how many sessions it alone would leave. */
/** The two rosters a mention chip can stand for, deciding what its press does. */
export const MENTION_CHIP_KIND = {
  SESSION: "session",
  ISSUE: "issue",
} as const;

/**
 * One app mark trailing a session chip's name: the same associations the
 * session's own row wears, answering where the chat is also held. Copied onto
 * the chip rather than looked up at draw time, so the band held through its
 * fade-out keeps wearing them after the roster moves on.
 */
export type MentionChipApplication = {
  id: string;
  name: string;
};

/**
 * One pressable chip of the notice band: the mark and words it draws, and the
 * identity its press hands to the main process — where it is validated
 * against the observed roster again before any address reaches the system.
 * Resolved onto the chip when its mention is, so the band held through its
 * fade-out keeps saying what it said.
 */
export type MentionChip =
  | {
      kind: typeof MENTION_CHIP_KIND.SESSION;
      id: string;
      markId: string;
      title: string;
      identity: SessionIdentity;
      applications: readonly MentionChipApplication[];
    }
  | {
      kind: typeof MENTION_CHIP_KIND.ISSUE;
      id: string;
      markId: string;
      title: string;
      identity: IssueIdentity;
    };

/**
 * The chips a fixture run's own sentence earns. A fixture run observes no
 * provider, so the roster a reply's mentions resolve against is empty and the
 * band would stand at no rows at all — while the sentence the profile speaks
 * was written to name four of the fixture's sessions and one of its
 * workspaces precisely so the evidence photographs it. The rows the surface
 * is already drawing answer for the roster here, matched by the same rules a
 * live reply is matched by, so what the PNG shows is the band a live reply
 * naming the same things would draw.
 */
export function fixtureMentionChips(
  caption: string,
  sessions: readonly SessionSnapshot[],
): readonly MentionChip[] {
  const rows = sessions.map((session) => ({
    providerId: session.providerId,
    providerSessionId: session.id,
    title: session.title,
    observedAt: session.observedAt,
    ...(session.workspace
      ? {
          workspace: {
            providerWorkspaceId: session.workspace.id,
            ...(session.workspace.scopeId ? { scopeId: session.workspace.scopeId } : undefined),
            name: session.workspace.name,
          },
        }
      : undefined),
  }));
  return mentionedSessions(caption, rows).flatMap((mention): readonly MentionChip[] => {
    const session = sessions.find(
      (candidate) =>
        candidate.providerId === mention.providerId && candidate.id === mention.providerSessionId,
    );
    if (!session) return [];
    const markId = session.agentId ?? session.providerId;
    return [
      {
        kind: MENTION_CHIP_KIND.SESSION,
        id: session.id,
        markId,
        title:
          mention.kind === SESSION_MENTION_KIND.WORKSPACE && session.workspace !== undefined
            ? session.workspace.name
            : session.title,
        identity: { providerId: session.providerId, providerSessionId: session.id },
        applications: (session.applications ?? []).flatMap((application) =>
          application.id === markId ? [] : [{ id: application.id, name: application.name }],
        ),
      },
    ];
  });
}

export interface SessionFilterOption {
  filter: SessionFilter;
  label: string;
  count: number;
  /**
   * Set when the chip stands for one brand — an agent, associated app, or
   * workspace manager — so the row can draw that brand's own mark where the
   * coarser chips carry a word.
   */
  markId?: string;
}

/** One axis's choices, offered as a labelled row of the options sheet. */
export interface SessionFilterGroup {
  axis: SessionFilterAxis;
  label: string;
  options: readonly SessionFilterOption[];
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
  /** The selection actually in force, which is empty whenever the chosen one emptied. */
  filters: readonly SessionFilter[];
  groups: readonly SessionFilterGroup[];
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
  /** One app each, seated where its first session reads under the sort. */
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
 * blank query has no words, which is what makes it no search at all. Exported
 * for the settings search, so the two searches cannot disagree about what a
 * word is.
 */
export function searchTokens(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * The lines a query is read against: everything the row itself can say — its
 * title, the sentence under it, the branch and repository, the workspace it is
 * a chat of — plus identifiers the row does not always spend a line on: the
 * agent's name and its model, kept on the mark's hover, and the workspace of
 * a lone chat, which earns no tray to name it. Those still find the session —
 * each is a name the provider's own surface knows it by — so a row can match
 * without a mark to show for it; the marks only ever land on the lines the
 * row draws. The status word is its own line because the detail sentence only
 * falls back to it: a row busy saying what it is doing must still answer for
 * the state it is in.
 */
function searchableLines(session: DisplaySession): readonly string[] {
  const lines = [
    session.title,
    session.detail,
    session.label,
    session.branch,
    session.repository,
    session.workspace?.name,
    session.provider,
    session.agent,
    session.model,
    ...session.applications.map((application) => application.name),
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
        applications: (session.applications ?? []).map((application) => ({
          ...application,
          openable: false,
        })),
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
        const openApplication = session.applications.find(
          (application) => application.link === session.detail.link,
        );
        const displaySession: DisplaySession = {
          id: session.providerSessionId,
          title: session.title,
          providerId: session.providerId,
          provider: session.provider.displayName,
          ...(session.agent
            ? { agentId: session.agent.id, agent: session.agent.displayName }
            : undefined),
          applications: session.applications.map((application) => ({
            id: application.id,
            name: application.displayName,
            scope: application.scope,
            openable: application.link !== undefined,
          })),
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
          ...(openApplication ? { openApplication: openApplication.displayName } : undefined),
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
                workspace: (() => {
                  const workspace: DisplayWorkspace = {
                    id: session.workspace.providerWorkspaceId,
                    name: session.workspace.name ?? session.workspace.providerWorkspaceId,
                  };
                  if (session.workspace.scopeId) {
                    workspace.scopeId = session.workspace.scopeId;
                  }
                  if (session.workspace.managerName) {
                    workspace.managerName = session.workspace.managerName;
                  }
                  return workspace;
                })(),
              }
            : undefined),
        };
        if (session.realtimeVoice === true) displaySession.realtimeVoice = true;
        return displaySession;
      });

  return [...visible].sort(byUrgency);
}

const LOCATION_LABEL = {
  [SESSION_LOCATION.LOCAL]: "Local",
  [SESSION_LOCATION.CLOUD]: "Cloud",
};

/** The order the location chips read in: what runs here, then what runs away. */
const LOCATION_ORDER: readonly SessionLocation[] = [SESSION_LOCATION.LOCAL, SESSION_LOCATION.CLOUD];

const VOICE_FILTER_OPTION = { filter: SESSION_FILTER.VOICE, label: "Voice" } as const;

/** The order the sheet's rows read in: coarse to fine, top to bottom. */
const FILTER_AXIS_ORDER: readonly SessionFilterAxis[] = [
  SESSION_FILTER_AXIS.LOCATION,
  SESSION_FILTER_AXIS.KIND,
  SESSION_FILTER_AXIS.APP,
  SESSION_FILTER_AXIS.AGENT,
];

const FILTER_AXIS_LABEL = {
  [SESSION_FILTER_AXIS.LOCATION]: "Location",
  [SESSION_FILTER_AXIS.KIND]: "Kind",
  [SESSION_FILTER_AXIS.APP]: "App",
  [SESSION_FILTER_AXIS.AGENT]: "Agent",
};

/**
 * Where a session runs, whether it is voice, which apps associate with it,
 * and which agent is running it — one labelled row per axis, coarse to fine.
 * Each identity is offered only where it is a real choice: one counting every
 * session — or none — narrows nothing, and an axis left with no chips costs
 * no row in the sheet.
 * The counts make each row a breakdown of what is tracked before it is a
 * control, which is what earns it the line it costs.
 *
 * Agents are listed in the registry's own order rather than by how many
 * sessions they have, so a chip never moves out from under the pointer as
 * sessions come and go.
 */
function filterGroups(sessions: readonly DisplaySession[]): readonly SessionFilterGroup[] {
  if (sessions.length === 0) return [];

  const locations = new Map<SessionLocation, number>();
  const brands = new Map<string, { label: string; count: number }>();
  const applicationIds = new Set<SessionApplicationId>();
  const providerIds = new Set<ProviderId | HostedAgentId>();
  let voiceCount = 0;
  let managed = 0;
  for (const session of sessions) {
    locations.set(session.location, (locations.get(session.location) ?? 0) + 1);
    if (session.realtimeVoice === true) voiceCount += 1;
    if (session.workspace?.scopeId === SESSION_FILTER.SUPERSET) managed += 1;
    const identities = new Map<string, string>();
    if (isProviderId(session.providerId)) {
      identities.set(session.providerId, session.provider);
      providerIds.add(session.providerId);
    }
    // A hosted chat answers its agent's chip too: a Claude conversation in
    // Conductor's cloud is a Claude conversation for the agent axis, and an
    // agent that exists only inside a hosting app — DeepSeek Harness, Pi —
    // earns the same chip under its own hosted identity.
    if (session.agentId && (isProviderId(session.agentId) || isHostedAgentId(session.agentId))) {
      identities.set(session.agentId, session.agent ?? session.agentId);
      providerIds.add(session.agentId);
    }
    for (const application of session.applications) {
      if (!isSessionApplicationId(application.id)) continue;
      identities.set(application.id, application.name);
      applicationIds.add(application.id);
    }
    for (const [id, label] of identities) {
      const tally = brands.get(id);
      brands.set(id, { label, count: (tally?.count ?? 0) + 1 });
    }
  }

  const locationOptions =
    locations.size > 1
      ? LOCATION_ORDER.filter((location) => locations.has(location)).map((location) => ({
          filter: location,
          label: LOCATION_LABEL[location],
          count: locations.get(location) ?? 0,
        }))
      : [];
  const managedOptions =
    managed > 0 && managed < sessions.length
      ? [
          {
            filter: SESSION_FILTER.SUPERSET,
            label: "Superset",
            count: managed,
            markId: SUPERSET_WORKSPACE_PROVIDER_ID,
          },
        ]
      : [];
  const applicationOptions = SESSION_APPLICATION_ID_LIST.filter(
    (applicationId) =>
      applicationId !== SESSION_FILTER.SUPERSET && applicationIds.has(applicationId),
  )
    .filter((applicationId) => {
      const count = brands.get(applicationId)?.count ?? 0;
      return count > 0 && count < sessions.length;
    })
    .map((applicationId) => ({
      filter: applicationId,
      label: brands.get(applicationId)?.label ?? applicationId,
      count: brands.get(applicationId)?.count ?? 0,
      markId: applicationId,
    }));
  const applicationOptionIds = new Set<string>(applicationOptions.map((option) => option.filter));
  const providerOptions =
    providerIds.size > 1
      ? // Hosted agents take chips after the providers, in each registry's
        // own order, so the rail does not reshuffle as sessions come and go.
        [...PROVIDER_ID_LIST, ...HOSTED_AGENT_ID_LIST]
          .filter((providerId) => brands.has(providerId) && !applicationOptionIds.has(providerId))
          .filter((providerId) => {
            const count = brands.get(providerId)?.count ?? 0;
            return count > 0 && count < sessions.length;
          })
          .map((providerId) => ({
            filter: providerId,
            label: brands.get(providerId)?.label ?? providerId,
            count: brands.get(providerId)?.count ?? 0,
            markId: providerId,
          }))
      : [];
  const voiceOptions =
    voiceCount > 0 && voiceCount < sessions.length
      ? [{ ...VOICE_FILTER_OPTION, count: voiceCount }]
      : [];

  // Seated by each value's own axis rather than by the list it was built in,
  // so Conductor's chip lands on the app row even when only native Conductor
  // chats put it on offer.
  const byAxis = new Map<SessionFilterAxis, SessionFilterOption[]>();
  for (const option of [
    ...locationOptions,
    ...voiceOptions,
    ...managedOptions,
    ...applicationOptions,
    ...providerOptions,
  ]) {
    const axis = sessionFilterAxis(option.filter);
    const held = byAxis.get(axis) ?? [];
    held.push(option);
    byAxis.set(axis, held);
  }
  return FILTER_AXIS_ORDER.flatMap((axis) => {
    const options = byAxis.get(axis);
    return options === undefined ? [] : [{ axis, label: FILTER_AXIS_LABEL[axis], options }];
  });
}

/** Whether two rows are chats of one workspace. */
function sameWorkspace(first: DisplaySession, second: DisplaySession): boolean {
  return (
    first.workspace !== undefined &&
    second.workspace !== undefined &&
    (first.workspace.scopeId ?? first.providerId) ===
      (second.workspace.scopeId ?? second.providerId) &&
    first.workspace.id === second.workspace.id
  );
}

/**
 * Seats every workspace's chats together without disturbing what the sort
 * decided: a workspace sits where its best-read chat sorted, and its other
 * chats follow in their own sorted order, so the group is exactly as urgent —
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

/** The tray header's pull request, and the chat whose report carries it. */
export interface WorkspaceTrayChange {
  session: DisplaySession;
  changeNumber?: number;
}

/**
 * The pull request a tray's header offers: a workspace's chats work one
 * branch, so each chat reporting the change draws the same chip and the tray
 * reads as several pull requests when every press opens the one — the header
 * says it once, where the workspace is named once. Hoisted only while the
 * reports are provably one change: a single reporting chat, or every report
 * naming the same number. Two chats naming different numbers are two changes,
 * and reports the numbers cannot compare stay on their own rows rather than
 * letting the header stand one chip for what may be two. The first reporting
 * chat is the one the press travels through, which keeps the open validated
 * against the same roster row that reported it.
 */
export function workspaceTrayChange(
  sessions: readonly DisplaySession[],
): WorkspaceTrayChange | undefined {
  const reporting = sessions.filter((session) => session.hasChange);
  const [first] = reporting;
  if (!first) return undefined;
  const oneChange =
    reporting.length === 1 ||
    (first.changeNumber !== undefined &&
      reporting.every((session) => session.changeNumber === first.changeNumber));
  if (!oneChange) return undefined;
  return {
    session: first,
    ...(first.changeNumber !== undefined ? { changeNumber: first.changeNumber } : undefined),
  };
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
 * The list as it is drawn. A chosen selection whose last session has since
 * left — an agent's only session finished, say, or a combination no session
 * answers any more — falls back whole to the unnarrowed list rather than
 * leaving an empty panel, because the one thing this list may never do is
 * hide a session the capsule is still counting. Whole rather than value by
 * value: which surviving part of a combination to keep is a choice, and the
 * list correcting itself must not choose for the developer.
 *
 * Showing something is the whole of the test: a selection still matching
 * sessions survives even while no chip offers a value in it, which happens
 * when a spoken ask names the only provider or location there is. Collapsing
 * it then would be quietly wrong twice over — Luke has just said the list was
 * narrowed, and the moment a second agent appeared the list would widen out
 * from under a developer who asked to watch one. While a filter is chipless
 * it hides nothing (every session matches), and as soon as another value
 * exists its chip and the options button's "showing" badge both appear.
 *
 * A query is the one narrowing allowed to empty the list, because it is a
 * question rather than a way of viewing: "nothing matches" is its honest
 * answer, where a filter falling to nothing is a stale choice to be dropped.
 * It reads within the filters — search narrows what is being shown — and what
 * the filters hide is counted rather than swallowed, so an emptied search can
 * offer the matches sitting behind the chips instead of denying they exist.
 */
export function arrangeSessions(
  sessions: readonly DisplaySession[],
  view: SessionView,
): ArrangedSessions {
  const groups = filterGroups(sessions);
  const chosen =
    view.filters.length === 0
      ? sessions
      : sessions.filter((session) => matchesSessionFilters(session, view.filters));
  const filters = chosen.length > 0 ? view.filters : [];
  const matching = filters === view.filters ? chosen : sessions;

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
                  (session) =>
                    !matchesSessionFilters(session, filters) && matchesQuery(session, tokens),
                ).length,
        };

  return {
    sessions: seatWorkspacesTogether([...found].sort(bySort(view.sort))),
    total: sessions.length,
    filters,
    groups,
    ...(search ? { search } : undefined),
  };
}

/**
 * Counted across everything tracked, whatever the list is narrowed to — but
 * read in the sort the list is read in, so the apps sit in the order their
 * first sessions do and the wing's marks follow the rows. With no view in
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

    // The wing draws the app holding the chat — the lead of the row's own
    // application marks, which the workspace manager already heads — so the
    // strip says where the tracked work is held rather than which agent runs
    // it. A chat no app holds still counts under its provider's own mark.
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
