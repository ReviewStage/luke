import { text, type UnparsedWireValue } from "@sidecar/wire";

/**
 * Provider-observed condition. Distinct from `SESSION_URGENCY`, the surface's
 * ranked disposition: both contain the literal "working", so the brand keeps
 * one from being passed where the other is expected.
 */
type SessionStatusBrand<T extends string> = T & { readonly __brand: "SessionStatus" };

function sessionStatusBrand<T extends string>(value: T): SessionStatusBrand<T> {
  // SAFETY: brands a session-status literal at the vocabulary boundary.
  return value as SessionStatusBrand<T>;
}

export const SESSION_STATUS = {
  WORKING: sessionStatusBrand("working"),
  WAITING: sessionStatusBrand("waiting"),
  /**
   * The session stopped on something it cannot get past on its own. Providers
   * report this natively — a Conductor `error`, a Cursor `ERROR` run, a Claude
   * Code `api_error` — and it is kept distinct from `waiting` because the two
   * ask different things of the developer: one wants an answer, the other wants
   * a rescue.
   */
  ERROR: sessionStatusBrand("error"),
  COMPLETE: sessionStatusBrand("complete"),
  UNKNOWN: sessionStatusBrand("unknown"),
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
 * report live state, or a timestamp that marks when that state was entered,
 * rather than a heartbeat — so a long turn is still working and a completed
 * or failed session stays that way however long ago it finished. Once waiting
 * is stale, Luke cannot tell a turn that just asked for the user from one
 * they walked away from hours ago, and reporting the stale state would speak
 * at the wrong moment.
 */
export function agedStatus(
  status: SessionStatus,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (status !== SESSION_STATUS.WAITING) return status;
  return now - observedAt <= freshnessMs ? status : SESSION_STATUS.UNKNOWN;
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

/**
 * How long a status keeps its session on the roster, measured from the moment
 * the status was entered. This is the one bound on the roster — no adapter
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
  session: Pick<NormalizedSession, "status" | "observedAt">,
  now: number,
): boolean {
  return now - session.observedAt <= sessionRosterRetentionMs(session.status);
}

/** The sessions still worth a row, in the order they arrived. */
export function rosterRelevantSessions(
  sessions: readonly NormalizedSession[],
  now: number,
): readonly NormalizedSession[] {
  return sessions.filter((session) => isRosterRelevant(session, now));
}

/** The label a session takes when Luke cannot name the folder or repository it belongs to. */
export const UNKNOWN_WORKSPACE_LABEL = "workspace";

/**
 * Where a session's work is actually running. It is not the provider: the same
 * provider can hold a session on this machine and one in a datacentre, and only
 * the session knows which it is. Local is the default, so a session is only
 * reported as remote by an adapter that observed it over the network.
 */
export const SESSION_LOCATION = {
  LOCAL: "local",
  CLOUD: "cloud",
} as const;

export type SessionLocation = (typeof SESSION_LOCATION)[keyof typeof SESSION_LOCATION];

export const ATTENTION_DISPOSITION = {
  SILENT: "silent",
  SPEAK_DURING_TURN: "speak-during-turn",
  SPEAK_AT_TURN_END: "speak-at-turn-end",
} as const;

export type AttentionDisposition =
  (typeof ATTENTION_DISPOSITION)[keyof typeof ATTENTION_DISPOSITION];

/**
 * A bounded, display-safe result from Luke's attention evaluation. The summary
 * must be a redacted synopsis, never a provider transcript.
 */
export interface AttentionDecision {
  disposition: AttentionDisposition;
  decidedAt: number;
  summary?: string;
  /**
   * Whether the summary answers the developer's standing ask about this
   * session. Only an answer earns an ask's privilege — being heard with no
   * call open — so an evaluator speaking about a watched session for its own
   * reasons stays on the evaluator's terms.
   */
  answersAsk?: boolean;
}

/**
 * What a control does to the session, at the altitude a surface draws at: a
 * stop ends the turn that is running and is drawn as the stop glyph every chat
 * surface uses, while anything else is a provider-worded action drawn by its
 * label. The adapter says which its control is, because only it knows what the
 * endpoint behind the control means.
 */
export const SESSION_CONTROL_KIND = {
  ACTION: "action",
  STOP: "stop",
} as const;

export type SessionControlKind = (typeof SESSION_CONTROL_KIND)[keyof typeof SESSION_CONTROL_KIND];

/** A provider-defined action that has been explicitly exposed for one session. */
export interface SessionControl {
  id: string;
  label: string;
  /** Absent means a plain action, drawn by its label. */
  kind?: SessionControlKind;
  /**
   * The provider-owned identifier of the thing this control acts on, when that
   * is not the session itself — the run a stop stops, or the workspace an
   * archive files away. It rides the advertisement so it is replaced with
   * every observation and can never outlive the snapshot that promised it,
   * the way state an adapter kept on the side could.
   */
  target?: string;
}

/** A stable provider identity and the label that can be shown in the UI. */
export interface SessionProvider {
  id: string;
  displayName: string;
}

/**
 * Apps that can hold a local agent session without becoming that session's
 * agent provider. A Codex conversation, for example, can be visible in both
 * Conductor and ChatGPT while it remains a Codex conversation.
 */
export const SESSION_APPLICATION_ID = {
  CHATGPT: "chatgpt",
  CMUX: "cmux",
  CONDUCTOR: "conductor",
  ORCA: "orca",
  SUPERSET: "superset",
} as const;

export type SessionApplicationId =
  (typeof SESSION_APPLICATION_ID)[keyof typeof SESSION_APPLICATION_ID];

export const SESSION_APPLICATION_ID_LIST: readonly SessionApplicationId[] =
  Object.values(SESSION_APPLICATION_ID);

export function isSessionApplicationId(value: string): value is SessionApplicationId {
  return SESSION_APPLICATION_ID_LIST.some((candidate) => candidate === value);
}

/** Where an app association is drawn when several chats share one workspace. */
export const SESSION_APPLICATION_SCOPE = {
  SESSION: "session",
  WORKSPACE: "workspace",
} as const;

export type SessionApplicationScope =
  (typeof SESSION_APPLICATION_SCOPE)[keyof typeof SESSION_APPLICATION_SCOPE];

/**
 * One app in which an observed local session appears. The optional address is
 * the app's exact route to that chat; absence means Luke can name the
 * association but has no documented way to open it.
 */
export interface SessionApplication {
  id: string;
  displayName: string;
  scope: SessionApplicationScope;
  link?: string;
}

/** Identifies a session without conflating identifiers from different providers. */
export interface SessionIdentity {
  providerId: string;
  providerSessionId: string;
}

/**
 * The schemes Luke will hand a session's address to the operating system with:
 * `https` for a provider that keeps the session in its own cloud, and an app
 * scheme for one that registered a handler for its own windows on this machine.
 *
 * A link is the one observed field the surface does not merely draw — it acts on
 * it — and it arrives from provider-owned data like every other field. So the
 * set is fixed by this build and applied where every other bound is applied:
 * an address outside it never reaches a session at all, rather than being
 * checked again wherever something is about to open one.
 */
export const SESSION_LINK_SCHEME = {
  HTTPS: "https:",
  CMUX: "cmux:",
  CODEX: "codex:",
  CONDUCTOR: "conductor:",
  SUPERSET: "superset:",
} as const;

export type SessionLinkScheme = (typeof SESSION_LINK_SCHEME)[keyof typeof SESSION_LINK_SCHEME];

const SESSION_LINK_SCHEMES: ReadonlySet<string> = new Set(Object.values(SESSION_LINK_SCHEME));

/** Whether an address is one Luke may ask the system to open. */
export function isOpenableSessionLink(link: string): boolean {
  try {
    return SESSION_LINK_SCHEMES.has(new URL(link).protocol);
  } catch {
    return false;
  }
}

/**
 * The context that makes one session tellable from another. Every field is
 * optional because no provider reports all of them, and every field is bounded
 * so a row stays a row. Adapters fill in whatever their provider actually
 * knows rather than composing a sentence, which leaves the wording to the
 * surface that renders it and the reasoning to the attention evaluator.
 */
export interface SessionDetail {
  /** What the session is doing right now, such as the tool it is running. */
  activity?: string;
  repository?: string;
  branch?: string;
  model?: string;
  /** Why the session stopped, when it stopped on something it cannot pass. */
  error?: string;
  /**
   * A provider-owned address that opens this session where it lives. Only a
   * provider that can address the session itself reports one: an address that
   * lands near a session rather than on it — its folder, or a fresh chat in the
   * same place — is worse than no address at all, because pressing a row would
   * then do something other than what it said.
   */
  link?: string;
  /** The work the session has published, such as a pull request. */
  change?: string;
  /** The size of the change the session holds, as its provider counts it. */
  diff?: SessionDiffSummary;
}

/**
 * A provider's own counts for a session's change: files touched, lines added,
 * lines removed. Counts rather than words, because the surface words them —
 * an adapter reports the numbers its provider actually returned and composes
 * nothing.
 */
export interface SessionDiffSummary {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * The place a provider groups several sessions under — a workspace holding
 * more than one chat. It is identity plus a name, nothing else: the id is what
 * a surface groups rows by and the name is what it titles the group, and a
 * session without one is simply ungrouped. Only an adapter whose provider
 * actually nests chats inside a shared workspace reports it; inventing a
 * group around a provider's lone sessions would draw structure that is not
 * there.
 */
export interface SessionWorkspace {
  providerWorkspaceId: string;
  /**
   * The namespace that owns the workspace identity. It is normally the
   * session provider, but an orchestrator may group sessions from several
   * providers under one workspace of its own.
   */
  scopeId?: string;
  /** The bounded product name shown when an orchestrator owns this workspace. */
  managerName?: string;
  name?: string;
}

/**
 * Provider-owned data observed for a session. Provider adapters are responsible
 * for observing without writing provider files, and for bounding every field
 * they report so one session cannot crowd out the rest of the panel.
 */
export interface ProviderSessionObservation {
  providerSessionId: string;
  /**
   * The provider-owned id of the session that directly spawned this one,
   * when the provider persists that relationship. It is identity only: the
   * child remains its own session with its own status and row.
   */
  parentProviderSessionId?: string;
  title: string;
  status: SessionStatus;
  /** Why a completed row became complete, when the provider can distinguish it. */
  completionCause?: SessionCompletionCause;
  observedAt: number;
  /** Whether this session is a realtime voice/delegation chat. */
  realtimeVoice?: boolean;
  /**
   * Whether a realtime voice conversation is live over this session right now,
   * read from the provider's own persisted state. Where `realtimeVoice` names
   * what the chat is, this names what is happening to it, and it ends when the
   * conversation does. Absent means none observed.
   */
  realtimeVoiceLive?: boolean;
  /** Omitted by an adapter that reads sessions off this machine. */
  location?: SessionLocation;
  /**
   * The agent having the conversation, when the session's provider hosts
   * agents rather than being one — a Conductor chat is a Claude Code or Codex
   * conversation before it is a Conductor one. Identity only: the provider
   * stays the thing observed, credentialed, and written through, and a host
   * that did not say which agent runs a chat reports none rather than a guess.
   */
  agent?: SessionProvider;
  /**
   * A bounded recap of where the work stands — provider-designated, or a
   * settled turn's parting words. Never the transcript behind it.
   */
  recap?: string;
  detail?: SessionDetail;
  /** Apps on this machine that independently associate themselves with the session. */
  applications?: readonly SessionApplication[];
  controls?: readonly SessionControl[];
  /**
   * Set only by an adapter whose provider documents taking a message for this
   * session in its current state, through the provider's own API. Absent means
   * no: a session that cannot be messaged is reported as such rather than
   * offered a control that would have to be improvised.
   */
  canReceiveMessage?: boolean;
  /**
   * Set only by an adapter whose provider documents renaming this session
   * itself, through the provider's own API, under the same absent-means-no
   * rule. The chat's own name is what this renames; the workspace around it
   * advertises its rename separately, as `renameTarget`.
   */
  canRename?: boolean;
  /**
   * The kinds of agent this session's provider documents starting alongside it
   * — in the same workspace — named exactly as the provider's creation
   * endpoint takes them. Absent means none: only an adapter whose provider
   * documents such an endpoint lists anything, and an ask can only name an
   * agent from this list.
   */
  spawnableAgents?: readonly string[];
  /**
   * The provider-owned identifier of the place a new agent lands — the
   * workspace around this session — when that is narrower than the session
   * itself. Like a control's `target`, it rides the advertisement so it is
   * replaced with every observation and can never outlive the snapshot that
   * promised it, the way state an adapter kept on the side could.
   */
  spawnTarget?: string;
  /**
   * The provider-owned identifier of the workspace a rename lands on, present
   * only when the provider documents renaming the workspace around this
   * session. Like `spawnTarget`, it rides the advertisement so it is replaced
   * with every observation and can never outlive the snapshot that promised
   * it, the way state an adapter kept on the side could.
   */
  renameTarget?: string;
  /** The workspace this session is one chat of, when its provider nests them. */
  workspace?: SessionWorkspace;
}

/**
 * The normalized model shared by observers, attention evaluation, the UI, and
 * any future capability-gated controls.
 */
export interface NormalizedSession extends SessionIdentity {
  provider: SessionProvider;
  /** The immediate provider-owned parent of this independently observed session. */
  parentProviderSessionId?: string;
  title: string;
  status: SessionStatus;
  completionCause?: SessionCompletionCause;
  observedAt: number;
  /** Whether this session is a realtime voice/delegation chat. */
  realtimeVoice?: boolean;
  /** Whether a realtime voice conversation is live over this session right now. */
  realtimeVoiceLive?: boolean;
  location: SessionLocation;
  /** The agent behind this session, when its provider hosts rather than is it. */
  agent?: SessionProvider;
  recap?: string;
  detail: SessionDetail;
  /** Apps on this machine that independently associate themselves with the session. */
  applications: readonly SessionApplication[];
  controls: readonly SessionControl[];
  /** Whether this session's provider will take a message for it right now. */
  canReceiveMessage: boolean;
  /** Whether this session's provider documents renaming the chat itself. */
  canRename: boolean;
  /** The agents that can be started alongside this session, or none. */
  spawnableAgents: readonly string[];
  /** Where a started agent lands, when narrower than the session itself. */
  spawnTarget?: string;
  /** The workspace a rename lands on, when its provider documents renaming it. */
  renameTarget?: string;
  /** The workspace this session is one chat of, when its provider nests them. */
  workspace?: SessionWorkspace;
  attention: AttentionDecision;
}

export const maximumSessionTitleLength = 160;
/**
 * Every app this build can recognize at once, and no more: the bound exists to
 * refuse an unbounded roster decoration, not to drop the newest association on
 * a chat every manager holds, so it follows the value set rather than sitting
 * on a literal the next app silently overflows.
 */
export const maximumSessionApplications = SESSION_APPLICATION_ID_LIST.length;
/** An agent kind is a short identifier, never a sentence. */
export const maximumSpawnableAgentLength = 40;
/** How many kinds of agent one session may offer to start. */
export const maximumSpawnableAgents = 8;
export const maximumSessionRecapLength = 500;
/** One line of context beside a title, not a paragraph. */
export const maximumSessionDetailLength = 120;
/** Long enough for any provider's session address without becoming a payload. */
export const maximumSessionLinkLength = 300;
/** A reply typed into a row, not a document pasted through one. */
export const maximumSessionMessageLength = 4_000;

/**
 * The text of a message on its way to a session, or nothing. Unlike an observed
 * field this one is refused rather than cut when it runs long: a truncated
 * message says something its author did not.
 */
export function sessionMessageText(value: UnparsedWireValue): string | undefined {
  const normalized = text(value);
  if (!normalized || normalized.length > maximumSessionMessageLength) return undefined;
  return normalized;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

/** Trims and cuts a provider-written field to its bound, or drops an empty one. */
export function boundedText(value: string | undefined, maximumLength: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximumLength);
}

/**
 * A session's address, or nothing. Unlike every other bounded field this one is
 * dropped rather than cut when it runs long: a truncated address is a different
 * address, and this is the field something is opened from.
 */
function sessionLink(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumSessionLinkLength) return undefined;
  return isOpenableSessionLink(normalized) ? normalized : undefined;
}

/**
 * The published work's address, or nothing, under the link's own rules — a
 * truncated address is a different address — narrowed further to `https`
 * alone: every pull request a provider reports lives on the web, and this
 * field too is one the surface acts on rather than merely draws.
 */
function sessionChange(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumSessionLinkLength) return undefined;
  try {
    return new URL(normalized).protocol === SESSION_LINK_SCHEME.HTTPS ? normalized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The pull request's own number, read from the published work's address so a
 * surface can name the work the way its host does — "#245" — instead of the
 * generic words. Every host this build has seen a change from ends the
 * address with the number (GitHub's `/pull/245`, GitLab's
 * `/-/merge_requests/3`, Bitbucket's `/pull-requests/9`), so the final path
 * segment is the number or the address names none. Nothing but the number
 * ever leaves this read: an address whose tail is not one yields nothing,
 * and the surface keeps the generic words rather than guessing.
 */
export function sessionChangeNumber(change: string): number | undefined {
  let tail: string | undefined;
  try {
    tail = new URL(change).pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
  return tail !== undefined && /^\d+$/.test(tail) ? Number(tail) : undefined;
}

/** A count a row can draw; anything past it is a report to distrust whole. */
export const maximumSessionDiffCount = 999_999;

/**
 * A provider's diff counts, or nothing. Dropped whole rather than partially:
 * one count outside sense makes the others' claim on the row suspect, and a
 * summary of all zeroes says nothing a row should spend words on.
 */
function sessionDiff(diff: SessionDiffSummary | undefined): SessionDiffSummary | undefined {
  if (!diff) return undefined;
  const counts = [diff.filesChanged, diff.linesAdded, diff.linesRemoved];
  const sound = counts.every(
    (count) => Number.isSafeInteger(count) && count >= 0 && count <= maximumSessionDiffCount,
  );
  if (!sound || counts.every((count) => count === 0)) return undefined;
  return {
    filesChanged: diff.filesChanged,
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
  };
}

function timestamp(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite timestamp`);
  }
  return value;
}

function normalizeStatus(status: SessionStatus): SessionStatus {
  if (!Object.values(SESSION_STATUS).includes(status)) {
    throw new Error(`Unknown session status: ${status}`);
  }
  return status;
}

function normalizeCompletionCause(
  cause: SessionCompletionCause | undefined,
  status: SessionStatus,
): SessionCompletionCause | undefined {
  if (cause === undefined) return undefined;
  if (!Object.values(SESSION_COMPLETION_CAUSE).includes(cause)) {
    throw new Error(`Unknown session completion cause: ${cause}`);
  }
  if (status !== SESSION_STATUS.COMPLETE) {
    throw new Error("A session completion cause requires complete status");
  }
  return cause;
}

function normalizeLocation(location: SessionLocation | undefined): SessionLocation {
  if (location === undefined) return SESSION_LOCATION.LOCAL;
  if (!Object.values(SESSION_LOCATION).includes(location)) {
    throw new Error(`Unknown session location: ${location}`);
  }
  return location;
}

function normalizeControls(
  controls: readonly SessionControl[] | undefined,
): readonly SessionControl[] {
  if (!controls) return [];

  const ids = new Set<string>();
  return controls.map((control) => {
    const id = requiredText(control.id, "control id");
    if (ids.has(id)) throw new Error(`Duplicate session control: ${id}`);
    ids.add(id);
    // A kind this build does not know is dropped rather than passed through:
    // the control still works, drawn as a plain action by its label.
    const kind = Object.values(SESSION_CONTROL_KIND).find(
      (candidate) => candidate === control.kind,
    );
    const target = boundedText(control.target, maximumSessionDetailLength);
    const normalized: SessionControl = {
      id,
      label: boundedText(control.label, maximumSessionTitleLength) ?? id,
    };
    if (kind) normalized.kind = kind;
    if (target) normalized.target = target;
    return normalized;
  });
}

function normalizeApplications(
  applications: readonly SessionApplication[] | undefined,
): readonly SessionApplication[] {
  if (!applications) return [];

  const ids = new Set<string>();
  const normalized: SessionApplication[] = [];
  for (const application of applications) {
    const id = boundedText(application.id, maximumSessionDetailLength);
    if (!id || ids.has(id)) continue;
    const scope = Object.values(SESSION_APPLICATION_SCOPE).find(
      (candidate) => candidate === application.scope,
    );
    if (!scope) throw new Error(`Unknown session application scope: ${application.scope}`);
    const displayName = boundedText(application.displayName, maximumSessionTitleLength) ?? id;
    const link = sessionLink(application.link);
    normalized.push({ id, displayName, scope, ...(link ? { link } : undefined) });
    ids.add(id);
    if (normalized.length >= maximumSessionApplications) break;
  }
  const order = (id: string): number =>
    isSessionApplicationId(id)
      ? SESSION_APPLICATION_ID_LIST.indexOf(id)
      : SESSION_APPLICATION_ID_LIST.length;
  return normalized.sort((first, second) => order(first.id) - order(second.id));
}

/**
 * Bounds every field a provider reported and drops the ones it left empty, so
 * a renderer can treat any present field as worth drawing.
 */
export function normalizeSessionDetail(detail: SessionDetail | undefined): SessionDetail {
  if (!detail) return {};

  const activity = boundedText(detail.activity, maximumSessionDetailLength);
  const repository = boundedText(detail.repository, maximumSessionDetailLength);
  const branch = boundedText(detail.branch, maximumSessionDetailLength);
  const model = boundedText(detail.model, maximumSessionDetailLength);
  const error = boundedText(detail.error, maximumSessionDetailLength);
  const link = sessionLink(detail.link);
  const change = sessionChange(detail.change);
  const diff = sessionDiff(detail.diff);

  const result: SessionDetail = {};
  if (activity) result.activity = activity;
  if (repository) result.repository = repository;
  if (branch) result.branch = branch;
  if (model) result.model = model;
  if (error) result.error = error;
  if (link) result.link = link;
  if (change) result.change = change;
  if (diff) result.diff = diff;
  return result;
}

/**
 * Bounds and deduplicates the agents a session offers to start beside it. An
 * entry outside its bound is dropped rather than cut: a truncated agent kind
 * names a different agent, and this list is what a creation ask is held to.
 */
function normalizeSpawnableAgents(agents: readonly string[] | undefined): readonly string[] {
  if (!agents) return [];
  const unique = new Set<string>();
  for (const agent of agents) {
    const normalized = agent.trim();
    if (!normalized || normalized.length > maximumSpawnableAgentLength) continue;
    unique.add(normalized);
    if (unique.size >= maximumSpawnableAgents) break;
  }
  return [...unique];
}

/**
 * The workspace a session reported around itself, or nothing. A workspace
 * without an id cannot group anything, so it is dropped whole rather than
 * kept as a group no sibling chat could ever be matched to.
 */
function normalizeWorkspace(workspace: SessionWorkspace | undefined): SessionWorkspace | undefined {
  const providerWorkspaceId = boundedText(
    workspace?.providerWorkspaceId,
    maximumSessionDetailLength,
  );
  if (!providerWorkspaceId) return undefined;
  const scopeId = boundedText(workspace?.scopeId, maximumSessionDetailLength);
  const managerName = boundedText(workspace?.managerName, maximumSessionDetailLength);
  const name = boundedText(workspace?.name, maximumSessionTitleLength);
  const normalized: SessionWorkspace = { providerWorkspaceId };
  if (scopeId) normalized.scopeId = scopeId;
  if (managerName) normalized.managerName = managerName;
  if (name) normalized.name = name;
  return normalized;
}

/**
 * The agent behind a hosted session, or nothing. An agent naming the session's
 * own provider says nothing the provider id does not, so it is dropped rather
 * than drawn twice.
 */
function normalizeAgent(
  agent: SessionProvider | undefined,
  providerId: string,
): SessionProvider | undefined {
  const id = boundedText(agent?.id, maximumSessionDetailLength);
  if (!id || id === providerId) return undefined;
  return { id, displayName: boundedText(agent?.displayName, maximumSessionTitleLength) ?? id };
}

/** Normalizes the two-part identity used to locate a session in the registry. */
export function normalizeSessionIdentity(identity: SessionIdentity): SessionIdentity {
  return {
    providerId: requiredText(identity.providerId, "provider id"),
    providerSessionId: requiredText(identity.providerSessionId, "provider session id"),
  };
}

/** Creates the silent default used until an attention evaluator returns a decision. */
export function silentAttention(observedAt: number): AttentionDecision {
  return {
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: timestamp(observedAt, "observedAt"),
  };
}

/** Ensures an attention decision is safe to share with the rest of the app. */
export function normalizeAttention(decision: AttentionDecision): AttentionDecision {
  if (!Object.values(ATTENTION_DISPOSITION).includes(decision.disposition)) {
    throw new Error(`Unknown attention disposition: ${decision.disposition}`);
  }
  const summary = boundedText(decision.summary, maximumSessionRecapLength);
  const normalized: AttentionDecision = {
    disposition: decision.disposition,
    decidedAt: timestamp(decision.decidedAt, "attention decidedAt"),
  };
  if (summary) normalized.summary = summary;
  if (decision.answersAsk) normalized.answersAsk = true;
  return normalized;
}

/**
 * Normalizes a provider observation without retaining provider-specific shapes.
 * A supplied attention decision is used by the registry when an evaluator has
 * already made one for this session.
 */
export function normalizeSession(
  provider: SessionProvider,
  observation: ProviderSessionObservation,
  attention = silentAttention(observation.observedAt),
): NormalizedSession {
  const { providerId, providerSessionId } = normalizeSessionIdentity({
    providerId: provider.id,
    providerSessionId: observation.providerSessionId,
  });
  const observedAt = timestamp(observation.observedAt, "observedAt");
  const status = normalizeStatus(observation.status);
  const completionCause = normalizeCompletionCause(observation.completionCause, status);
  const recap = boundedText(observation.recap, maximumSessionRecapLength);
  const parentProviderSessionId = boundedText(
    observation.parentProviderSessionId,
    maximumSessionDetailLength,
  );
  const spawnTarget = boundedText(observation.spawnTarget, maximumSessionDetailLength);
  const renameTarget = boundedText(observation.renameTarget, maximumSessionDetailLength);
  const workspace = normalizeWorkspace(observation.workspace);
  const agent = normalizeAgent(observation.agent, providerId);

  const session: NormalizedSession = {
    providerId,
    providerSessionId,
    provider: {
      id: providerId,
      displayName: boundedText(provider.displayName, maximumSessionTitleLength) ?? providerId,
    },
    title: boundedText(observation.title, maximumSessionTitleLength) ?? "Untitled session",
    status,
    observedAt,
    location: normalizeLocation(observation.location),
    detail: normalizeSessionDetail(observation.detail),
    applications: normalizeApplications(observation.applications),
    controls: normalizeControls(observation.controls),
    // Anything but an explicit yes is a no, so an adapter that has not thought
    // about messaging reports a session that cannot be messaged.
    canReceiveMessage: observation.canReceiveMessage === true,
    canRename: observation.canRename === true,
    spawnableAgents: normalizeSpawnableAgents(observation.spawnableAgents),
    attention: normalizeAttention(attention),
  };
  if (observation.realtimeVoice === true) session.realtimeVoice = true;
  if (observation.realtimeVoiceLive === true) session.realtimeVoiceLive = true;
  if (parentProviderSessionId && parentProviderSessionId !== providerSessionId) {
    session.parentProviderSessionId = parentProviderSessionId;
  }
  if (completionCause) session.completionCause = completionCause;
  if (recap) session.recap = recap;
  if (agent) session.agent = agent;
  if (spawnTarget) session.spawnTarget = spawnTarget;
  if (renameTarget) session.renameTarget = renameTarget;
  if (workspace) session.workspace = workspace;
  return session;
}

/** Returns whether a provider explicitly exposed a given control for a session. */
export function supportsSessionControl(session: NormalizedSession, controlId: string): boolean {
  return session.controls.some((control) => control.id === controlId);
}
