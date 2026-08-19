import { Effect } from "effect";
import { text, type UnparsedWireValue } from "./json.js";
import type { ProviderSessionObservation, SessionControl, SessionProvider } from "./session.js";

/**
 * Stable provider identifiers shared by adapters, the registry, and the UI.
 * They key provider-specific presentation (such as a mark) without a renderer
 * having to import adapter code or match on a display name.
 */
export const PROVIDER_ID = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CONDUCTOR: "conductor",
  COPILOT: "copilot",
  CURSOR: "cursor",
  DEVIN: "devin",
  JULES: "jules",
  OPENCODE: "opencode",
} as const;

export type ProviderId = (typeof PROVIDER_ID)[keyof typeof PROVIDER_ID];

/**
 * The order any list of providers reads in. It is the registry's own order
 * rather than one derived from live sessions, so a list of agents does not
 * reshuffle as their sessions come and go.
 */
export const PROVIDER_ID_LIST: readonly ProviderId[] = Object.values(PROVIDER_ID);

const PROVIDER_IDS: ReadonlySet<string> = new Set(PROVIDER_ID_LIST);

/** Whether this build knows the provider an observation names. */
export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.has(value);
}

/**
 * A provider adapter has no dependency on Electron, a renderer, or live UI
 * state. Every adapter answers every act, because unsupported is already an
 * answer rather than a failure: one whose provider documents no way to do a
 * thing inherits that answer from `SessionProviderAdapterBase` and says so,
 * where a missing method would leave each caller asking whether the question
 * could be put at all. Overriding one is what taking on its constraint means.
 */
export interface SessionProviderAdapter {
  readonly provider: SessionProvider;
  observe(): Effect.Effect<readonly ProviderSessionObservation[], unknown, unknown>;

  /**
   * Runs a control against a session the adapter has already observed.
   * Adapters must reject any request whose control that session's latest
   * observation did not advertise.
   */
  executeControl(
    request: ProviderControlRequest,
  ): Effect.Effect<ProviderControlResult, unknown, unknown>;

  /**
   * Hands a message to an already-observed session through the provider's own
   * documented endpoint. It is one of the three places an adapter may change
   * provider state, and only ever with text a user chose to send: adapters
   * must refuse any session that did not advertise `canReceiveMessage` on its
   * latest observation, and nothing that decides on the user's behalf — the
   * attention evaluator above all — may reach it.
   */
  sendMessage(
    message: ProviderSessionMessage,
  ): Effect.Effect<ProviderMessageResult, unknown, unknown>;

  /** The projects the latest observation pass reported, or none. */
  workspaceProjects(): readonly WorkspaceProject[];

  /**
   * Creates a workspace in a project the latest observation pass reported. The
   * same rules bind it that bind a message: it acts only on what a user just
   * asked for, through the provider's own documented endpoint, and nothing
   * that decides on the user's behalf may reach it.
   */
  createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, unknown, unknown>;

  /**
   * Starts another agent in the workspace an observed session already runs in,
   * under the same rules and one more: the agent must be one of the kinds that
   * session's latest observation listed.
   */
  spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Effect.Effect<ProviderWorkspaceResult, unknown, unknown>;

  /**
   * Renders one observed session's own transcript, read from the provider's
   * file on this machine, into a bounded conversation kept nowhere. The read
   * performs nothing and reaches no provider; an adapter whose stored shape
   * this build cannot render faithfully reports nothing rather than guessing.
   */
  readTranscript(providerSessionId: string): Effect.Effect<string | undefined, unknown, unknown>;
}

/**
 * What became of a write the user asked for. Every adapter capability answers
 * with the same three: accepted, rejected with a reason the user can act on,
 * or unsupported — the adapter has no documented way to do this, which is an
 * answer rather than a failure. One status set, because two identical triples
 * would be an API break the moment they diverged.
 */
export const PROVIDER_ACT_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ProviderActResultStatus =
  (typeof PROVIDER_ACT_RESULT_STATUS)[keyof typeof PROVIDER_ACT_RESULT_STATUS];

export type ProviderActResult =
  | { status: typeof PROVIDER_ACT_RESULT_STATUS.ACCEPTED }
  | { status: typeof PROVIDER_ACT_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };

/** A provider-local request for a control that was previously exposed by observation. */
export interface ProviderControlRequest {
  providerSessionId: string;
  control: SessionControl;
}

/**
 * What became of a control. Providers must report unsupported or rejected
 * controls explicitly; the core deliberately provides no fallback path such
 * as terminal input injection.
 */
export type ProviderControlResult = ProviderActResult;

/** A user-authored message for one session the adapter has already observed. */
export interface ProviderSessionMessage {
  providerSessionId: string;
  text: string;
}

/**
 * What became of a send. A rejection carries a reason the user can act on,
 * never the message itself; unsupported means the adapter has no documented
 * way to message this session, which is an answer rather than a failure.
 */
export type ProviderMessageResult = ProviderActResult;

/**
 * Whether a new workspace in a project carries an opening task — the
 * developer's own words for what its agent should start on. A provider whose
 * creation endpoint requires a prompt cannot make an idle workspace, and one
 * that documents no way to hand a task at creation cannot take one; each
 * project says which it is, so an ask can be validated before a request
 * exists.
 */
export const WORKSPACE_TASK_SUPPORT = {
  NONE: "none",
  OPTIONAL: "optional",
  REQUIRED: "required",
} as const;

export type WorkspaceTaskSupport =
  (typeof WORKSPACE_TASK_SUPPORT)[keyof typeof WORKSPACE_TASK_SUPPORT];

const WORKSPACE_TASK_SUPPORT_LIST: readonly WorkspaceTaskSupport[] =
  Object.values(WORKSPACE_TASK_SUPPORT);

/**
 * One place a provider will create a workspace: a project it reported on the
 * latest observation pass. A request can only name one of these, so the set of
 * places a workspace can be asked for is the set the provider itself listed —
 * never a repository URL or path composed on this side.
 */
export interface WorkspaceProject {
  /** The provider-owned identifier a creation request names the project by. */
  providerProjectId: string;
  /** The repository label the project is named by out loud and on screen. */
  repository: string;
  /** Whether a new workspace here takes — or needs — an opening task. */
  taskSupport: WorkspaceTaskSupport;
  /** The provider-owned host or execution target that owns this project. */
  providerTargetId?: string;
  /** The bounded label a person uses to distinguish that target. */
  targetName?: string;
  /** Agent kinds the provider currently permits for a new workspace here. */
  spawnableAgents?: readonly string[];
  /** The saved agent kind used when a creation ask names none. */
  defaultAgent?: string;
}

/** A workspace project as the app reports it, stamped with who offered it. */
export interface ObservedWorkspaceProject extends WorkspaceProject {
  providerId: string;
  providerName: string;
}

/** The identity a saved default uses, including a host when one owns it. */
export function workspaceProjectSelectionId(
  project: Pick<WorkspaceProject, "providerProjectId" | "providerTargetId">,
): string {
  return project.providerTargetId
    ? JSON.stringify([project.providerProjectId, project.providerTargetId])
    : project.providerProjectId;
}

/**
 * The providers whose stored default names no project they currently offer —
 * a choice that steers nothing, because every path that reads it matches
 * against the offered set. Only providers present in `projects` are judged: a
 * provider offering nothing is observing nothing, and a default must not be
 * discarded on that silence.
 */
export function staleWorkspaceProjectDefaults(
  projects: readonly ObservedWorkspaceProject[],
  defaults: Readonly<Partial<Record<string, string>>> | undefined,
): readonly string[] {
  if (!defaults) return [];
  const offered = new Map<string, Set<string>>();
  for (const project of projects) {
    const selections = offered.get(project.providerId) ?? new Set<string>();
    selections.add(workspaceProjectSelectionId(project));
    offered.set(project.providerId, selections);
  }
  return [...offered.entries()]
    .filter(([providerId, selections]) => {
      const stored = defaults[providerId];
      return stored !== undefined && !selections.has(stored);
    })
    .map(([providerId]) => providerId);
}

/** A workspace name reads in one breath; anything longer is a different ask. */
export const maximumWorkspaceNameLength = 80;

/** How many projects the app will offer workspace creation in at once. */
export const maximumObservedWorkspaceProjects = 20;

/**
 * The name a new workspace was asked for under, or nothing. Refused rather
 * than cut when it runs long, the same posture as a message: a truncated name
 * says something its author did not.
 */
export function workspaceNameText(value: UnparsedWireValue): string | undefined {
  const normalized = text(value);
  if (!normalized || normalized.length > maximumWorkspaceNameLength) return undefined;
  return normalized;
}

/**
 * Bounds, deduplicates, and alphabetizes the projects adapters offered, so
 * the surface and the conversation are handed the same capped, display-safe
 * list. Ordered by the repository label a person scans for — not by which
 * adapter answered first — and capped after the sort, so a list too long to
 * keep whole loses its alphabetical tail rather than an arbitrary provider.
 */
export function normalizeObservedWorkspaceProjects(
  projects: readonly ObservedWorkspaceProject[],
  preferredSelections?: Readonly<Partial<Record<string, string>>>,
): readonly ObservedWorkspaceProject[] {
  const seen = new Map<string, Map<string, Set<string>>>();
  const normalized: ObservedWorkspaceProject[] = [];
  for (const project of projects) {
    const providerId = project.providerId.trim();
    const providerProjectId = project.providerProjectId.trim();
    const providerTargetId = project.providerTargetId?.trim() ?? "";
    const repository = project.repository.trim().slice(0, maximumWorkspaceNameLength);
    if (!providerId || !providerProjectId || !repository) continue;
    const byProvider = seen.get(providerId) ?? new Map<string, Set<string>>();
    const byProject = byProvider.get(providerProjectId) ?? new Set<string>();
    if (byProject.has(providerTargetId)) continue;
    byProject.add(providerTargetId);
    byProvider.set(providerProjectId, byProject);
    seen.set(providerId, byProvider);
    const normalizedProject: ObservedWorkspaceProject = {
      providerId,
      providerName: project.providerName.trim() || providerId,
      providerProjectId,
      repository,
      // A support level this build does not know is read as none, so an ask
      // is refused rather than guessed at.
      taskSupport: WORKSPACE_TASK_SUPPORT_LIST.includes(project.taskSupport)
        ? project.taskSupport
        : WORKSPACE_TASK_SUPPORT.NONE,
    };
    if (providerTargetId) normalizedProject.providerTargetId = providerTargetId;
    const targetName = project.targetName?.trim();
    if (targetName) {
      normalizedProject.targetName = targetName.slice(0, maximumWorkspaceNameLength);
    }
    if (project.spawnableAgents) {
      normalizedProject.spawnableAgents = [
        ...new Set(project.spawnableAgents.map((agent) => agent.trim())),
      ]
        .filter(Boolean)
        .slice(0, 20);
    }
    const defaultAgent = project.defaultAgent?.trim();
    if (defaultAgent) normalizedProject.defaultAgent = defaultAgent;
    normalized.push(normalizedProject);
  }
  const sorted = normalized.sort(compareWorkspaceProjects);
  const preferred = sorted.filter(
    (project) => preferredSelections?.[project.providerId] === workspaceProjectSelectionId(project),
  );
  const ordinary = sorted.filter(
    (project) => preferredSelections?.[project.providerId] !== workspaceProjectSelectionId(project),
  );
  return [...preferred, ...ordinary]
    .slice(0, maximumObservedWorkspaceProjects)
    .sort(compareWorkspaceProjects);
}

function compareWorkspaceProjects(
  left: ObservedWorkspaceProject,
  right: ObservedWorkspaceProject,
): number {
  return (
    compareRepositoryLabels(left.repository, right.repository) ||
    // Two providers can offer one repository label; the provider and then the
    // id keep the order deterministic rather than arrival-dependent.
    left.providerName.localeCompare(right.providerName) ||
    left.providerProjectId.localeCompare(right.providerProjectId)
  );
}

/** Alphabetical the way a person reads labels: case-blind, digits as numbers. */
function compareRepositoryLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

/**
 * One model an agent runs: the id its provider's endpoints take, and the name
 * a person reads. The label stands alone — no vendor beside it — because a
 * model's own name already says whose it is.
 */
export interface WorkspaceAgentModel {
  id: string;
  label: string;
}

/**
 * One agent kind a provider's creation endpoints take, with the models it
 * runs and the effort levels it thinks at — all exactly as the provider
 * documents them. An app declares these as build-fixed tables, the way it
 * fixes any other documented value set, so a choice is only ever offered from
 * what the build knows the provider takes. An agent that takes no effort
 * levels documents an empty list, and is simply never offered one.
 */
export interface WorkspaceAgentModels {
  agent: string;
  models: readonly WorkspaceAgentModel[];
  efforts: readonly string[];
}

/**
 * The agent kind, model, and optionally effort a user chose for new
 * workspaces, as one value on purpose: a model id or an effort level only
 * means anything beside the agent that runs it, and fields stored apart could
 * recombine into a pairing no table ever listed. Effort is optional inside
 * the pair — absent, the provider's own default effort stands.
 */
export interface WorkspaceAgentSelection {
  /** The agent kind, exactly as the provider's documented set names it. */
  agent: string;
  /** The model id, exactly as documented for that agent. */
  model: string;
  /** The effort level, exactly as documented for that agent, when chosen. */
  effort?: string;
}

/** A user-asked request for a new workspace in one reported project. */
export interface ProviderWorkspaceRequest {
  providerProjectId: string;
  providerTargetId?: string;
  agent?: string;
  /** The name the user chose, when they chose one; the provider names it otherwise. */
  name?: string;
  /**
   * The opening task for the workspace's agent, in the user's own words —
   * present only when the user gave one, and only for a project whose
   * `taskSupport` takes it. It is the same class of content as a message to
   * an existing session, and it travels under the same rules.
   */
  task?: string;
  /**
   * The agent kind and model the user chose for new workspaces, present only
   * when they chose one and only from the build's documented table for this
   * provider. Absent, the provider's own defaults decide — the adapter sends
   * nothing at all rather than a guess.
   */
  agentSelection?: WorkspaceAgentSelection;
}

/**
 * What became of a creation ask — the same three answers a message gets, for
 * the same reasons: a rejection carries a reason the user can act on, and
 * unsupported means the provider documents no way to create one here. An
 * acceptance may also carry the id of the session the creation response
 * named — an identifier only, never an address — so the surface can open the
 * new workspace once an observation pass reports it under that id. A provider
 * whose response names no session simply omits it, and the workspace stands
 * unopened rather than guessed at.
 */
export type ProviderWorkspaceResult =
  | {
      status: typeof PROVIDER_ACT_RESULT_STATUS.ACCEPTED;
      /** The created session's id, exactly as the provider's response named it. */
      providerSessionId?: string;
      /** Creation landed, but a non-essential follow-up such as opening failed. */
      warning?: string;
    }
  | { status: typeof PROVIDER_ACT_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };

/**
 * A user-asked request for another agent in the workspace an observed session
 * already runs in. The session names the workspace; the agent must be one that
 * session's latest observation listed as spawnable.
 */
export interface ProviderWorkspaceAgentRequest {
  providerSessionId: string;
  /** The kind of agent, exactly as the observation listed it. */
  agent: string;
  /** The name the user chose, when they chose one. */
  name?: string;
  /** The new agent's opening task, in the user's own words, when they gave one. */
  task?: string;
  /**
   * The model the user's stored choice names for exactly this agent kind,
   * present only when the kinds match and the pairing is in the build's
   * documented table. The asked-for agent always wins over a stored pairing:
   * a preference rides along with the user's ask, never against it.
   */
  model?: string;
  /** The effort level riding with that model, under exactly the same rules. */
  effort?: string;
}

/**
 * The explicit answers an adapter gives for acts its provider does not
 * document: unsupported for every write, no projects, and no transcript.
 * Concrete adapters override only the acts their provider routes, and an
 * override takes on that act's constraint above along with it.
 */
export abstract class SessionProviderAdapterBase implements SessionProviderAdapter {
  abstract readonly provider: SessionProvider;
  abstract observe(): Effect.Effect<readonly ProviderSessionObservation[], unknown, unknown>;

  executeControl(
    _request: ProviderControlRequest,
  ): Effect.Effect<ProviderControlResult, unknown, unknown> {
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
  }

  sendMessage(
    _message: ProviderSessionMessage,
  ): Effect.Effect<ProviderMessageResult, unknown, unknown> {
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
  }

  workspaceProjects(): readonly WorkspaceProject[] {
    return [];
  }

  createWorkspace(
    _request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, unknown, unknown> {
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
  }

  spawnWorkspaceAgent(
    _request: ProviderWorkspaceAgentRequest,
  ): Effect.Effect<ProviderWorkspaceResult, unknown, unknown> {
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
  }

  readTranscript(_providerSessionId: string): Effect.Effect<string | undefined, unknown, unknown> {
    return Effect.succeed(undefined);
  }
}
