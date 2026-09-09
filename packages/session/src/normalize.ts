import {
  ACT_KIND,
  type AdvertisedAct,
  type AdvertisedActKind,
  type AdvertisedAddAgent,
  type AdvertisedControl,
  SESSION_CONTROL_KIND,
} from "./advertised-acts.js";
import {
  boundedAgentKinds,
  boundedText,
  maximumSessionApplications,
  maximumSessionDetailLength,
  maximumSessionTitleLength,
  requiredText,
  sessionChange,
  sessionDiffSummary,
  sessionLink,
  timestamp,
} from "./bounds.js";
import {
  isSessionApplicationId,
  SESSION_APPLICATION_ID_LIST,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  type SessionApplication,
  type SessionIdentity,
  type SessionLocation,
  type SessionProvider,
} from "./session-identity.js";
import type {
  ProviderSessionObservation,
  Session,
  SessionDetail,
  SessionWorkspace,
} from "./session-shape.js";
import {
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionCompletionCause,
  type SessionStatus,
} from "./session-status.js";

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
 * The app whose workspace groups the chat leads the row's marks: a grouped
 * chat is worked in its manager's window before anywhere else, so the
 * manager's mark comes first and the fixed order carries the rest. The row's
 * own press follows the first linked mark below, which is what makes this
 * ordering the one place a press's precedence is decided.
 */
function applicationsLedByManager(
  applications: readonly SessionApplication[],
  managerScopeId: string | undefined,
): readonly SessionApplication[] {
  if (!managerScopeId) return applications;
  const lead = applications.find((application) => application.id === managerScopeId);
  if (!lead) return applications;
  return [lead, ...applications.filter((application) => application !== lead)];
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
  const diff = sessionDiffSummary(detail.diff);

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

/**
 * Bounds the acts an observation advertised, under the rules each kind was
 * always held to. A control needs an id, and a repeated one is a provider
 * contradicting itself about what a press means, so it throws where every
 * other malformed entry is dropped; a singleton kind advertised twice keeps
 * the first; an add-agent whose kinds all fall outside their bound advertises
 * nothing rather than an empty list an ask could not be held to; and a
 * workspace rename with no target names nothing to rename. The adapter's own
 * order is kept, because it is the order a surface draws.
 */
function normalizeAdvertisedActs(
  advertises: readonly AdvertisedAct[] | undefined,
): readonly AdvertisedAct[] {
  if (!advertises) return [];

  const controlIds = new Set<string>();
  const singletonKinds = new Set<AdvertisedActKind>();
  const normalized: AdvertisedAct[] = [];
  for (const act of advertises) {
    if (act.kind === ACT_KIND.CONTROL) {
      const id = requiredText(act.id, "control id");
      if (controlIds.has(id)) throw new Error(`Duplicate session control: ${id}`);
      controlIds.add(id);
      // A kind this build does not know is dropped rather than passed through:
      // the control still works, drawn as a plain action by its label.
      const controlKind = Object.values(SESSION_CONTROL_KIND).find(
        (candidate) => candidate === act.controlKind,
      );
      const target = boundedText(act.target, maximumSessionDetailLength);
      const control: AdvertisedControl = {
        kind: ACT_KIND.CONTROL,
        id,
        label: boundedText(act.label, maximumSessionTitleLength) ?? id,
      };
      if (controlKind) control.controlKind = controlKind;
      if (target) control.target = target;
      normalized.push(control);
      continue;
    }
    if (singletonKinds.has(act.kind)) continue;
    singletonKinds.add(act.kind);
    if (act.kind === ACT_KIND.ADD_AGENT) {
      const agents = boundedAgentKinds(act.agents);
      if (agents.length === 0) continue;
      const target = boundedText(act.target, maximumSessionDetailLength);
      const addAgent: AdvertisedAddAgent = { kind: ACT_KIND.ADD_AGENT, agents };
      if (target) addAgent.target = target;
      normalized.push(addAgent);
      continue;
    }
    if (act.kind === ACT_KIND.RENAME_WORKSPACE) {
      const target = boundedText(act.target, maximumSessionDetailLength);
      if (!target) continue;
      normalized.push({ kind: ACT_KIND.RENAME_WORKSPACE, target });
      continue;
    }
    normalized.push({ kind: act.kind });
  }
  return normalized;
}

/** Normalizes the two-part identity used to locate a session in the registry. */
export function normalizeSessionIdentity(identity: SessionIdentity): SessionIdentity {
  return {
    providerId: requiredText(identity.providerId, "provider id"),
    providerSessionId: requiredText(identity.providerSessionId, "provider session id"),
  };
}

/** Normalizes a provider observation without retaining provider-specific shapes. */
export function normalizeSession(
  provider: SessionProvider,
  observation: ProviderSessionObservation,
): Session {
  const { providerId, providerSessionId } = normalizeSessionIdentity({
    providerId: provider.id,
    providerSessionId: observation.providerSessionId,
  });
  const lastActivityAt = timestamp(observation.lastActivityAt, "lastActivityAt");
  const status = normalizeStatus(observation.status);
  const completionCause = normalizeCompletionCause(observation.completionCause, status);
  const parentProviderSessionId = boundedText(
    observation.parentProviderSessionId,
    maximumSessionDetailLength,
  );
  const workspace = normalizeWorkspace(observation.workspace);
  const agent = normalizeAgent(observation.agent, providerId);
  const applications = applicationsLedByManager(
    normalizeApplications(observation.applications),
    workspace?.scopeId,
  );
  const detail = normalizeSessionDetail(observation.detail);
  // The row opens where its first linked mark leads. The marks are ordered by
  // who owns the chat — its workspace's manager ahead of the fixed order — so
  // the press's precedence is decided by that one ordering rather than by
  // whichever enricher wrote the row's link last, and a row with no linked
  // mark keeps the address its provider reported.
  const pressLink = applications.find((application) => application.link)?.link;
  if (pressLink) detail.link = pressLink;

  const session: Session = {
    providerId,
    providerSessionId,
    provider: {
      id: providerId,
      displayName: boundedText(provider.displayName, maximumSessionTitleLength) ?? providerId,
    },
    title: boundedText(observation.title, maximumSessionTitleLength) ?? "Untitled session",
    status,
    lastActivityAt,
    location: normalizeLocation(observation.location),
    detail,
    applications,
    advertises: normalizeAdvertisedActs(observation.advertises),
  } satisfies Session;
  if (observation.realtimeVoice === true) session.realtimeVoice = true;
  if (observation.realtimeVoiceLive === true) session.realtimeVoiceLive = true;
  if (observation.standing === true) session.standing = true;
  if (status === SESSION_STATUS.WAITING && observation.holdingForDeveloper === true) {
    session.holdingForDeveloper = true;
  }
  if (parentProviderSessionId && parentProviderSessionId !== providerSessionId) {
    session.parentProviderSessionId = parentProviderSessionId;
  }
  if (completionCause) session.completionCause = completionCause;
  if (agent) session.agent = agent;
  if (workspace) session.workspace = workspace;
  return session;
}
