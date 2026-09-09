import {
  ACT_KIND,
  ACT_RESULT_STATUS,
  type ActResultStatus,
  type AdvertisedControl,
  advertisedActFor,
  advertisedControl,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type CloudFetch,
  type HostedConversationAnswer,
  type HostedConversationMessage,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderActResult,
  type ProviderSessionObservation,
  type ProviderWorkspaceResult,
  type SessionProviderAdapter,
  type WorkspaceAgentSelection,
} from "../core.js";
import { cloudSessionAdapterFor } from "./cloud-adapters.js";

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
 * carry under the provider's documented endpoint.
 */
const SUPPORTED_ACTS = {
  [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: new Set<RemoteSessionAct>([
    REMOTE_SESSION_ACT.MESSAGE,
    REMOTE_SESSION_ACT.CONTROL,
    REMOTE_SESSION_ACT.AGENT,
    REMOTE_SESSION_ACT.RENAME_SESSION,
    REMOTE_SESSION_ACT.RENAME_WORKSPACE,
    REMOTE_SESSION_ACT.CREATE_WORKSPACE,
  ]),
} satisfies Readonly<Record<CloudAgentProviderId, ReadonlySet<RemoteSessionAct>>>;

/**
 * One act aimed at an observed session: what its provider-level absence is
 * worded from, what the fresh pass has to be advertising for it, what a
 * session not advertising it is told, and how it is delivered. Everything
 * else about executing one — the capability guard, the fresh observation
 * pass, finding the target in that pass, and mapping the provider's own
 * answer onto the wire — is the same for all of them and lives in
 * {@link executeSessionAct}.
 */
export interface SessionActPlan<Fields, Target> {
  /** What a provider that documents no way to do this is said not to document. */
  absence: string;
  /**
   * What the fresh pass advertised for this act, or undefined for a session
   * not offering it now. Read off the observation the request itself just
   * made, never off anything the caller sent, so the caller can name a target
   * but never describe one.
   */
  advertised: (observation: ProviderSessionObservation, fields: Fields) => Target | undefined;
  /** What a session whose latest observation does not advertise the act is told. */
  unadvertised: string;
  deliver: (
    adapter: SessionProviderAdapter,
    request: { providerSessionId: string; target: Target; fields: Fields },
  ) => Promise<ProviderActResult | ProviderWorkspaceResult>;
}

export const MESSAGE_ACT: SessionActPlan<{ text: string }, true> = {
  absence: "taking a message",
  advertised: (observation) => (advertisedActFor(observation, ACT_KIND.MESSAGE) ? true : undefined),
  unadvertised: "Session is not currently accepting messages.",
  deliver: (adapter, { providerSessionId, fields }) =>
    adapter.sendMessage({ providerSessionId, text: fields.text }),
};

export const CONTROL_ACT: SessionActPlan<{ controlId: string }, AdvertisedControl> = {
  absence: "any session controls",
  // The advertised control — never the caller's copy — is what reaches the
  // adapter, and the adapter re-finds it in its own snapshot besides.
  advertised: (observation, fields) => advertisedControl(observation, fields.controlId),
  unadvertised: "That control is not currently offered for this session.",
  deliver: (adapter, { providerSessionId, target }) =>
    adapter.executeControl({ providerSessionId, control: target }),
};

export const AGENT_ACT: SessionActPlan<{ agent: string; name?: string; task?: string }, true> = {
  absence: "starting another agent",
  advertised: (observation, fields) =>
    advertisedActFor(observation, ACT_KIND.ADD_AGENT)?.agents.includes(fields.agent)
      ? true
      : undefined,
  unadvertised: "That agent kind is not currently offered for this session's workspace.",
  deliver: (adapter, { providerSessionId, fields }) =>
    adapter.spawnWorkspaceAgent({
      providerSessionId,
      agent: fields.agent,
      name: fields.name,
      task: fields.task,
    }),
};

export const RENAME_SESSION_ACT: SessionActPlan<{ name: string }, true> = {
  absence: "renaming a session",
  advertised: (observation) =>
    advertisedActFor(observation, ACT_KIND.RENAME_SESSION) ? true : undefined,
  unadvertised: "Renaming this session is not currently offered.",
  deliver: (adapter, { providerSessionId, fields }) =>
    adapter.renameSession({ providerSessionId, name: fields.name }),
};

export const RENAME_WORKSPACE_ACT: SessionActPlan<{ name: string }, true> = {
  absence: "renaming a workspace",
  advertised: (observation) =>
    advertisedActFor(observation, ACT_KIND.RENAME_WORKSPACE) ? true : undefined,
  unadvertised: "Renaming this session's workspace is not currently offered.",
  deliver: (adapter, { providerSessionId, fields }) =>
    adapter.renameWorkspace({ providerSessionId, name: fields.name }),
};

/**
 * Creating a workspace aims at a project rather than at an observed session,
 * so it has no plan to run through {@link executeSessionAct}; it stands here
 * for the one thing every act has, which is how its absence is worded.
 */
const CREATE_WORKSPACE_ACT = { absence: "creating a workspace" };

/**
 * Every act by name. The `satisfies` is what makes the absence total: an act
 * added to `REMOTE_SESSION_ACT` without one does not compile.
 */
const SESSION_ACT_BY_NAME = {
  [REMOTE_SESSION_ACT.MESSAGE]: MESSAGE_ACT,
  [REMOTE_SESSION_ACT.CONTROL]: CONTROL_ACT,
  [REMOTE_SESSION_ACT.AGENT]: AGENT_ACT,
  [REMOTE_SESSION_ACT.RENAME_SESSION]: RENAME_SESSION_ACT,
  [REMOTE_SESSION_ACT.RENAME_WORKSPACE]: RENAME_WORKSPACE_ACT,
  [REMOTE_SESSION_ACT.CREATE_WORKSPACE]: CREATE_WORKSPACE_ACT,
} as const satisfies Readonly<Record<RemoteSessionAct, { absence: string }>>;

/**
 * The reason a provider cannot take this act, or undefined for one that can.
 * The routes ask before requiring a vault key — an unsupported provider
 * answers "unsupported" whether or not a key is stored — and the executor
 * asks again so the provider call is locally impossible to reach regardless
 * of that ordering.
 */
export function actUnsupportedReason(
  act: RemoteSessionAct,
  providerId: CloudAgentProviderId,
): string | undefined {
  if (SUPPORTED_ACTS[providerId].has(act)) return undefined;
  const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
  return `${displayName} does not document ${SESSION_ACT_BY_NAME[act].absence} through its API, so Luke does not offer it.`;
}

/** What an executed act answers with, in the hosted wire's own vocabulary. */
export interface ActExecutionAnswer {
  result: ActResultStatus;
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
  providerId: CloudAgentProviderId,
  apiKey: string,
  seams: ActExecuteSeams,
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
  });
  const observations = await adapter.observe();
  return { adapter, observations, ...pass };
}

/** Why an act's target was not in the fresh pass, as the user should hear it. */
function missingTargetReason(
  providerId: CloudAgentProviderId,
  pass: Pick<ObservedActPass, "unauthorized" | "unreachable">,
  missing: string,
): string {
  const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
  if (pass.unauthorized) return `${displayName} rejected the stored API key.`;
  if (pass.unreachable) return `Could not reach ${displayName}.`;
  return missing;
}

/**
 * Maps an adapter's own answer onto the hosted wire. An unsupported answer
 * from the adapter after the capability map said yes is an observation that
 * moved between the pass and the write, so it travels as a rejection — the
 * wire's "unsupported" is reserved for a provider that can never take the
 * act, which the routes and the guard below already answered.
 */
function fromProviderResult(
  result: ProviderActResult | ProviderWorkspaceResult,
): ActExecutionAnswer {
  if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
    return { result: ACT_RESULT_STATUS.REJECTED, reason: result.reason };
  }
  const providerSessionId = "providerSessionId" in result ? result.providerSessionId : undefined;
  return {
    result: ACT_RESULT_STATUS.ACCEPTED,
    ...(providerSessionId ? { providerSessionId } : undefined),
  };
}

function capabilityGuard(
  act: RemoteSessionAct,
  providerId: CloudAgentProviderId,
): ActExecutionAnswer | undefined {
  const reason = actUnsupportedReason(act, providerId);
  return reason ? { result: ACT_RESULT_STATUS.UNSUPPORTED, reason } : undefined;
}

/**
 * Validates and delivers one act aimed at an observed session: the provider
 * has to document the act at all, the fresh pass has to still hold the
 * session, and that pass's own advertisement has to still offer it. Only then
 * does the adapter see anything, and what it is handed is built from the
 * advertisement rather than from the ask.
 */
export async function executeSessionAct<Fields, Target>(
  plan: SessionActPlan<Fields, Target>,
  options: {
    act: RemoteSessionAct;
    providerId: CloudAgentProviderId;
    providerSessionId: string;
    fields: Fields;
    apiKey: string;
    seams?: ActExecuteSeams;
  },
): Promise<ActExecutionAnswer> {
  const { act, providerId, providerSessionId, fields, apiKey } = options;
  const guarded = capabilityGuard(act, providerId);
  if (guarded) return guarded;

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return {
      result: ACT_RESULT_STATUS.REJECTED,
      reason: missingTargetReason(providerId, pass, "Session not found."),
    };
  }
  const target = plan.advertised(observation, fields);
  if (target === undefined) {
    return { result: ACT_RESULT_STATUS.REJECTED, reason: plan.unadvertised };
  }
  return fromProviderResult(
    await plan.deliver(pass.adapter, { providerSessionId, target, fields }),
  );
}

export async function executeCreateWorkspaceAct(options: {
  providerId: CloudAgentProviderId;
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

  // A creation ask is validated against the projects the same pass reported.
  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const project = pass.adapter
    .workspaceProjects()
    .find((candidate) => candidate.providerProjectId === providerProjectId);
  if (!project) {
    return {
      result: ACT_RESULT_STATUS.REJECTED,
      reason: missingTargetReason(providerId, pass, "Project not found."),
    };
  }
  return fromProviderResult(
    await pass.adapter.createWorkspace({ providerProjectId, name, task, agentSelection }),
  );
}

/**
 * The providers whose adapters carry the documented conversation read,
 * mirroring exactly the `readConversation` seam each desktop adapter
 * implements — the adapter seam is the authority here as it is for acts, so
 * nothing may advertise a read the adapter does not already make under the
 * provider's documented endpoint. Conductor documents
 * `GET /v0/sessions/{id}/messages`; no other vaulted provider documents a
 * transcript read this build carries.
 */
const CONVERSATION_READ_PROVIDERS: ReadonlySet<CloudAgentProviderId> = new Set([
  CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
]);

/** Whether the messages endpoint can read this provider's conversations. */
export function providerReadsConversation(providerId: CloudAgentProviderId): boolean {
  return CONVERSATION_READ_PROVIDERS.has(providerId);
}

/** A conversation read that could not answer, with the reason it refused. */
export interface ConversationReadRefusal {
  refused: string;
}

/**
 * Reads one observed session's conversation for the caller who just opened
 * its screen: the same fresh-pass discipline every act keeps — the session
 * must stand behind the pass the same request ran — followed by the
 * adapter's own bounded read of the provider's documented transcript
 * endpoint. The answer is assembled and returned; nothing is stored.
 */
export async function executeConversationRead(options: {
  providerId: CloudAgentProviderId;
  providerSessionId: string;
  afterMessageId?: string;
  beforeOffset?: number;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<HostedConversationAnswer | ConversationReadRefusal> {
  const { providerId, providerSessionId, afterMessageId, beforeOffset, apiKey } = options;
  if (!providerReadsConversation(providerId)) {
    const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
    return {
      refused: `${displayName} does not document reading a session's conversation through its API, so Luke does not offer it.`,
    };
  }

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return { refused: missingTargetReason(providerId, pass, "Session not found.") };
  }

  const result = await pass.adapter.readConversation({
    providerSessionId,
    ...(afterMessageId ? { afterMessageId } : undefined),
    ...(beforeOffset !== undefined ? { beforeOffset } : undefined),
  });
  if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
    return { refused: result.reason };
  }
  // Copied field by field although the shapes are structurally identical
  // today: this map is the allowlist of what crosses onto the wire, so a
  // field the adapter's type grows later stays behind unless named here.
  const messages: HostedConversationMessage[] = result.messages.map((message) => ({
    id: message.id,
    author: message.author,
    text: message.text,
    ...(message.receivedAt !== undefined ? { receivedAt: message.receivedAt } : undefined),
  }));
  return {
    messages,
    ...(result.lastMessageId ? { lastMessageId: result.lastMessageId } : undefined),
    hasMore: result.hasMore,
    ...(result.firstOffset !== undefined ? { firstOffset: result.firstOffset } : undefined),
    ...(result.hasOlder !== undefined ? { hasOlder: result.hasOlder } : undefined),
  };
}
