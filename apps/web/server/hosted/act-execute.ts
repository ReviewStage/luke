import {
  ACT_RESULT_STATUS,
  type CloudFetch,
  HOSTED_ACT_RESULT,
  type HostedActResult,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderActResult,
  type ProviderSessionObservation,
  type ProviderWorkspaceResult,
  type SessionProviderAdapter,
  VAULT_PROVIDER_ID,
  type VaultProviderId,
  type WorkspaceAgentSelection,
} from "../core.js";
import {
  CURSOR_PROJECT_REFRESH,
  type CursorProjectRefresh,
  cloudSessionAdapterFor,
} from "./cloud-adapters.js";

/**
 * The acts a remote client can ask of a cloud session, named for the endpoint that
 * takes each. One vocabulary for the capability map below and for every route
 * that asks it, so a route cannot invent an act the map does not govern.
 */
export const REMOTE_SESSION_ACT = {
  MESSAGE: "message",
  CONTROL: "control",
  AGENT: "agent",
  RENAME_SESSION: "rename-session",
  RENAME_WORKSPACE: "rename-workspace",
  CREATE_WORKSPACE: "create-workspace",
} as const;

export type RemoteSessionAct = (typeof REMOTE_SESSION_ACT)[keyof typeof REMOTE_SESSION_ACT];

/**
 * Which acts each provider takes, mirroring exactly the write routes its
 * desktop adapter implements — the adapter seam is the authority for acts,
 * and nothing here may advertise a capability the adapter does not already
 * carry under the provider's documented endpoint. Copilot is deliberately
 * write-free: GitHub documents no way to message, steer, or stop an agent
 * task. Replicas advertises no controls and no renames; Devin and Jules
 * document no workspace creation for an API key.
 */
const SUPPORTED_ACTS = {
  [VAULT_PROVIDER_ID.CONDUCTOR]: new Set<RemoteSessionAct>([
    REMOTE_SESSION_ACT.MESSAGE,
    REMOTE_SESSION_ACT.CONTROL,
    REMOTE_SESSION_ACT.AGENT,
    REMOTE_SESSION_ACT.RENAME_SESSION,
    REMOTE_SESSION_ACT.RENAME_WORKSPACE,
    REMOTE_SESSION_ACT.CREATE_WORKSPACE,
  ]),
  [VAULT_PROVIDER_ID.COPILOT]: new Set<RemoteSessionAct>(),
  [VAULT_PROVIDER_ID.CURSOR]: new Set<RemoteSessionAct>([
    REMOTE_SESSION_ACT.MESSAGE,
    REMOTE_SESSION_ACT.CONTROL,
    REMOTE_SESSION_ACT.CREATE_WORKSPACE,
  ]),
  [VAULT_PROVIDER_ID.DEVIN]: new Set<RemoteSessionAct>([
    REMOTE_SESSION_ACT.MESSAGE,
    REMOTE_SESSION_ACT.CONTROL,
  ]),
  [VAULT_PROVIDER_ID.JULES]: new Set<RemoteSessionAct>([
    REMOTE_SESSION_ACT.MESSAGE,
    REMOTE_SESSION_ACT.CONTROL,
  ]),
  [VAULT_PROVIDER_ID.REPLICAS]: new Set<RemoteSessionAct>([
    REMOTE_SESSION_ACT.MESSAGE,
    REMOTE_SESSION_ACT.AGENT,
    REMOTE_SESSION_ACT.CREATE_WORKSPACE,
  ]),
} satisfies Readonly<Record<VaultProviderId, ReadonlySet<RemoteSessionAct>>>;

const ACT_ABSENCE_PHRASE = {
  [REMOTE_SESSION_ACT.MESSAGE]: "taking a message",
  [REMOTE_SESSION_ACT.CONTROL]: "any session controls",
  [REMOTE_SESSION_ACT.AGENT]: "starting another agent",
  [REMOTE_SESSION_ACT.RENAME_SESSION]: "renaming a session",
  [REMOTE_SESSION_ACT.RENAME_WORKSPACE]: "renaming a workspace",
  [REMOTE_SESSION_ACT.CREATE_WORKSPACE]: "creating a workspace",
} as const satisfies Readonly<Record<RemoteSessionAct, string>>;

/**
 * The reason a provider cannot take this act, or undefined for one that can.
 * The routes ask before requiring a vault key — an unsupported provider
 * answers "unsupported" whether or not a key is stored — and the executors
 * ask again so the provider call is locally impossible to reach regardless of
 * that ordering.
 */
export function actUnsupportedReason(
  act: RemoteSessionAct,
  providerId: VaultProviderId,
): string | undefined {
  if (SUPPORTED_ACTS[providerId].has(act)) return undefined;
  const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
  return `${displayName} does not document ${ACT_ABSENCE_PHRASE[act]} through its API, so Luke does not offer it.`;
}

/** What an executed act answers with, in the hosted wire's own vocabulary. */
export interface ActExecutionAnswer {
  result: HostedActResult;
  reason?: string;
  /** For creation-shaped acts: the session id the provider's response named. */
  providerSessionId?: string;
}

export interface ActExecuteSeams {
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * One adapter observed once for one act: the same re-observe-before-write
 * discipline the desktop keeps in its observation registry, here as a fresh
 * pass on a request-scoped instance. The adapter swallows credential and
 * network failures into an empty roster, so the pass watches its own fetch to
 * tell "the provider refused the key" and "the provider could not be reached"
 * apart from "the session is gone" when the act's target is missing.
 */
interface ObservedActPass {
  adapter: SessionProviderAdapter;
  observations: readonly ProviderSessionObservation[];
  unauthorized: boolean;
  unreachable: boolean;
}

async function observeForAct(
  providerId: VaultProviderId,
  apiKey: string,
  seams: ActExecuteSeams,
  cursorProjectRefresh?: CursorProjectRefresh,
): Promise<ObservedActPass> {
  const pass = { unauthorized: false, unreachable: false };
  const inner: CloudFetch = seams.fetch ?? ((url, init) => fetch(url, init));
  const watchingFetch: CloudFetch = async (url, init) => {
    try {
      const response = await inner(url, init);
      if (response.status === 401 || response.status === 403) pass.unauthorized = true;
      return response;
    } catch (error) {
      pass.unreachable = true;
      throw error;
    }
  };
  const adapter = cloudSessionAdapterFor(providerId, {
    readApiKey: async () => apiKey,
    fetch: watchingFetch,
    ...(seams.now ? { now: seams.now } : undefined),
    ...(cursorProjectRefresh ? { cursorProjectRefresh } : undefined),
  });
  const observations = await adapter.observe();
  return { adapter, observations, ...pass };
}

/** Why an act's target was not in the fresh pass, as the user should hear it. */
function missingTargetReason(
  providerId: VaultProviderId,
  pass: Pick<ObservedActPass, "unauthorized" | "unreachable">,
  missing: string,
): string {
  const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
  if (pass.unauthorized) return `${displayName} rejected the stored API key.`;
  if (pass.unreachable) return `Could not reach ${displayName}.`;
  return missing;
}

/**
 * Maps an adapter's own act answer onto the hosted wire. An unsupported
 * answer from the adapter after the capability map said yes is an observation
 * that moved between the pass and the write, so it travels as a rejection —
 * the wire's "unsupported" is reserved for a provider that can never take the
 * act, which the routes and executors already answered.
 */
function fromProviderActResult(result: ProviderActResult): ActExecutionAnswer {
  if (result.status === ACT_RESULT_STATUS.ACCEPTED) {
    return { result: HOSTED_ACT_RESULT.ACCEPTED };
  }
  return { result: HOSTED_ACT_RESULT.REJECTED, reason: result.reason };
}

function fromProviderWorkspaceResult(result: ProviderWorkspaceResult): ActExecutionAnswer {
  if (result.status === ACT_RESULT_STATUS.ACCEPTED) {
    return {
      result: HOSTED_ACT_RESULT.ACCEPTED,
      ...(result.providerSessionId ? { providerSessionId: result.providerSessionId } : undefined),
    };
  }
  return { result: HOSTED_ACT_RESULT.REJECTED, reason: result.reason };
}

function capabilityGuard(
  act: RemoteSessionAct,
  providerId: VaultProviderId,
): ActExecutionAnswer | undefined {
  const reason = actUnsupportedReason(act, providerId);
  return reason ? { result: HOSTED_ACT_RESULT.UNSUPPORTED, reason } : undefined;
}

export async function executeMessageAct(options: {
  providerId: VaultProviderId;
  providerSessionId: string;
  text: string;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<ActExecutionAnswer> {
  const { providerId, providerSessionId, text, apiKey } = options;
  const guarded = capabilityGuard(REMOTE_SESSION_ACT.MESSAGE, providerId);
  if (guarded) return guarded;

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: missingTargetReason(providerId, pass, "Session not found."),
    };
  }
  if (!observation.canReceiveMessage) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: "Session is not currently accepting messages.",
    };
  }
  return fromProviderActResult(await pass.adapter.sendMessage({ providerSessionId, text }));
}

export async function executeControlAct(options: {
  providerId: VaultProviderId;
  providerSessionId: string;
  controlId: string;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<ActExecutionAnswer> {
  const { providerId, providerSessionId, controlId, apiKey } = options;
  const guarded = capabilityGuard(REMOTE_SESSION_ACT.CONTROL, providerId);
  if (guarded) return guarded;

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: missingTargetReason(providerId, pass, "Session not found."),
    };
  }
  // The advertised control — never the caller's copy — is what reaches the
  // adapter, and the adapter re-finds it in its own snapshot besides.
  const advertised = observation.controls?.find((control) => control.id === controlId);
  if (!advertised) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: "That control is not currently offered for this session.",
    };
  }
  return fromProviderActResult(
    await pass.adapter.executeControl({ providerSessionId, control: advertised }),
  );
}

export async function executeAgentAct(options: {
  providerId: VaultProviderId;
  providerSessionId: string;
  agent: string;
  name: string | undefined;
  task: string | undefined;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<ActExecutionAnswer> {
  const { providerId, providerSessionId, agent, name, task, apiKey } = options;
  const guarded = capabilityGuard(REMOTE_SESSION_ACT.AGENT, providerId);
  if (guarded) return guarded;

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: missingTargetReason(providerId, pass, "Session not found."),
    };
  }
  if (!observation.spawnableAgents?.includes(agent)) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: "That agent kind is not currently offered for this session's workspace.",
    };
  }
  return fromProviderWorkspaceResult(
    await pass.adapter.spawnWorkspaceAgent({ providerSessionId, agent, name, task }),
  );
}

export async function executeRenameSessionAct(options: {
  providerId: VaultProviderId;
  providerSessionId: string;
  name: string;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<ActExecutionAnswer> {
  const { providerId, providerSessionId, name, apiKey } = options;
  const guarded = capabilityGuard(REMOTE_SESSION_ACT.RENAME_SESSION, providerId);
  if (guarded) return guarded;

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: missingTargetReason(providerId, pass, "Session not found."),
    };
  }
  if (!observation.canRename) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: "Renaming this session is not currently offered.",
    };
  }
  return fromProviderActResult(await pass.adapter.renameSession({ providerSessionId, name }));
}

export async function executeRenameWorkspaceAct(options: {
  providerId: VaultProviderId;
  providerSessionId: string;
  name: string;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<ActExecutionAnswer> {
  const { providerId, providerSessionId, name, apiKey } = options;
  const guarded = capabilityGuard(REMOTE_SESSION_ACT.RENAME_WORKSPACE, providerId);
  if (guarded) return guarded;

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: missingTargetReason(providerId, pass, "Session not found."),
    };
  }
  if (!observation.renameTarget) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: "Renaming this session's workspace is not currently offered.",
    };
  }
  return fromProviderActResult(await pass.adapter.renameWorkspace({ providerSessionId, name }));
}

export async function executeCreateWorkspaceAct(options: {
  providerId: VaultProviderId;
  providerProjectId: string;
  name: string | undefined;
  task: string | undefined;
  /** Already validated against the build's table by the handler. */
  agentSelection?: WorkspaceAgentSelection;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<ActExecutionAnswer> {
  const { providerId, providerProjectId, name, task, agentSelection, apiKey } = options;
  const guarded = capabilityGuard(REMOTE_SESSION_ACT.CREATE_WORKSPACE, providerId);
  if (guarded) return guarded;

  // A creation ask is validated against the projects the same pass reported,
  // so Cursor's project read — a background offer on the desktop — is awaited
  // here: this one pass is what the ask must be validated against.
  const pass = await observeForAct(
    providerId,
    apiKey,
    options.seams ?? {},
    providerId === VAULT_PROVIDER_ID.CURSOR ? CURSOR_PROJECT_REFRESH.AWAIT : undefined,
  );
  const project = pass.adapter
    .workspaceProjects()
    .find((candidate) => candidate.providerProjectId === providerProjectId);
  if (!project) {
    return {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: missingTargetReason(providerId, pass, "Project not found."),
    };
  }
  return fromProviderWorkspaceResult(
    await pass.adapter.createWorkspace({ providerProjectId, name, task, agentSelection }),
  );
}
