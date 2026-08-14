import type { ProviderSessionObservation, SessionControl, SessionProvider } from "./session";

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

export const PROVIDER_CONTROL_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ProviderControlResultStatus =
  (typeof PROVIDER_CONTROL_RESULT_STATUS)[keyof typeof PROVIDER_CONTROL_RESULT_STATUS];

/** A provider adapter has no dependency on Electron, a renderer, or live UI state. */
export interface SessionProviderAdapter {
  readonly provider: SessionProvider;
  observe(): Promise<readonly ProviderSessionObservation[]>;
}

/** A provider-local request for a control that was previously exposed by observation. */
export interface ProviderControlRequest {
  providerSessionId: string;
  control: SessionControl;
}

/**
 * Providers must report unsupported or rejected controls explicitly; the core
 * deliberately provides no fallback path such as terminal input injection.
 */
export type ProviderControlResult =
  | { status: typeof PROVIDER_CONTROL_RESULT_STATUS.ACCEPTED }
  | { status: typeof PROVIDER_CONTROL_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof PROVIDER_CONTROL_RESULT_STATUS.UNSUPPORTED };

/**
 * Optional extension for adapters with a reliable provider-owned control path.
 * Adapters must reject any request whose control was not advertised for the
 * observed session.
 */
export interface ControllableSessionProviderAdapter extends SessionProviderAdapter {
  executeControl(request: ProviderControlRequest): Promise<ProviderControlResult>;
}

/** Whether an adapter can run a control at all, before asking it to. */
export function isControllableAdapter(
  adapter: SessionProviderAdapter,
): adapter is ControllableSessionProviderAdapter {
  return (
    typeof (adapter as Partial<ControllableSessionProviderAdapter>).executeControl === "function"
  );
}

export const PROVIDER_MESSAGE_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ProviderMessageResultStatus =
  (typeof PROVIDER_MESSAGE_RESULT_STATUS)[keyof typeof PROVIDER_MESSAGE_RESULT_STATUS];

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
export type ProviderMessageResult =
  | { status: typeof PROVIDER_MESSAGE_RESULT_STATUS.ACCEPTED }
  | { status: typeof PROVIDER_MESSAGE_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };

/**
 * Optional extension for adapters whose provider documents a way to hand a
 * message to an existing session. It is the one place an adapter may change
 * provider state, and only ever with text a user chose to send: adapters must
 * refuse any session that did not advertise `canReceiveMessage` on its latest
 * observation, and nothing that decides on the user's behalf — the attention
 * evaluator above all — may reach this interface.
 */
export interface MessageCapableSessionProviderAdapter extends SessionProviderAdapter {
  sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult>;
}

/** Whether an adapter can carry a message at all, before asking it to. */
export function isMessageCapableAdapter(
  adapter: SessionProviderAdapter,
): adapter is MessageCapableSessionProviderAdapter {
  return (
    typeof (adapter as Partial<MessageCapableSessionProviderAdapter>).sendMessage === "function"
  );
}

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
}

/** A workspace project as the app reports it, stamped with who offered it. */
export interface ObservedWorkspaceProject extends WorkspaceProject {
  providerId: string;
  providerName: string;
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
export function workspaceNameText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumWorkspaceNameLength) return undefined;
  return normalized;
}

/**
 * Bounds and deduplicates the projects adapters offered, so the surface and
 * the conversation are handed the same capped, display-safe list.
 */
export function normalizeObservedWorkspaceProjects(
  projects: readonly ObservedWorkspaceProject[],
): readonly ObservedWorkspaceProject[] {
  const seen = new Map<string, Set<string>>();
  const normalized: ObservedWorkspaceProject[] = [];
  for (const project of projects) {
    const providerId = project.providerId.trim();
    const providerProjectId = project.providerProjectId.trim();
    const repository = project.repository.trim().slice(0, maximumWorkspaceNameLength);
    if (!providerId || !providerProjectId || !repository) continue;
    const byProvider = seen.get(providerId) ?? new Set<string>();
    if (byProvider.has(providerProjectId)) continue;
    byProvider.add(providerProjectId);
    seen.set(providerId, byProvider);
    normalized.push({
      providerId,
      providerName: project.providerName.trim() || providerId,
      providerProjectId,
      repository,
    });
    if (normalized.length >= maximumObservedWorkspaceProjects) break;
  }
  return normalized;
}

/** A user-asked request for a new workspace in one reported project. */
export interface ProviderWorkspaceRequest {
  providerProjectId: string;
  /** The name the user chose, when they chose one; the provider names it otherwise. */
  name?: string;
}

/**
 * What became of a creation ask — the same three answers a message gets, for
 * the same reasons: a rejection carries a reason the user can act on, and
 * unsupported means the provider documents no way to create one here.
 */
export type ProviderWorkspaceResult = ProviderMessageResult;

/**
 * Optional extension for adapters whose provider documents an endpoint that
 * creates a workspace. The same rules bind it that bind a message: it acts
 * only on what a user just asked for, only in a project the latest observation
 * pass reported, through the provider's own documented endpoint — and nothing
 * that decides on the user's behalf may reach it.
 */
export interface WorkspaceCapableSessionProviderAdapter extends SessionProviderAdapter {
  /** The projects the latest observation pass reported, or none. */
  workspaceProjects(): readonly WorkspaceProject[];
  createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult>;
}

/** Whether an adapter can create a workspace at all, before asking it to. */
export function isWorkspaceCapableAdapter(
  adapter: SessionProviderAdapter,
): adapter is WorkspaceCapableSessionProviderAdapter {
  const candidate = adapter as Partial<WorkspaceCapableSessionProviderAdapter>;
  return (
    typeof candidate.workspaceProjects === "function" &&
    typeof candidate.createWorkspace === "function"
  );
}
