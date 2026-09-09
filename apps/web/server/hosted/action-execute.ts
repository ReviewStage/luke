import {
  ACTION_KIND,
  ACTION_REFUSAL,
  ACTION_RESULT_STATUS,
  type ActionRequest,
  type ActionResultStatus,
  type AdmitContext,
  admit,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type CloudFetch,
  dispatchAction,
  dispatchByKind,
  dispatchConversation,
  type HostedConversationAnswer,
  type HostedConversationMessage,
  normalizeSession,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderActionResult,
  type ProviderSessionObservation,
  type ProviderWorkspaceResult,
  providerControlRequest,
  providerSessionMessage,
  providerSessionRenameRequest,
  providerWorkspaceAgentRequest,
  providerWorkspaceRenameRequest,
  providerWorkspaceRequest,
  type Refusal,
  RUN_ORIGIN,
  type SessionActionKind,
  type SessionProviderPlugin,
  type WireRecord,
  workspaceAgentModels,
} from "../core.js";
import { cloudSessionPluginFor } from "./cloud-adapters.js";

/**
 * The actions a remote client can ask of a cloud session: the session action kinds
 * this build's own action vocabulary names, less the open, which is not a write
 * and reaches no endpoint. One vocabulary for the capability map below, for
 * every route that names an action, and for admission, so a route cannot invent
 * an action the map does not govern or admission does not know.
 */
export type HostedSessionActionKind = Exclude<SessionActionKind, typeof ACTION_KIND.OPEN>;

/**
 * Which actions each provider takes, mirroring exactly the write routes its
 * desktop adapter implements — the adapter seam is the authority for actions,
 * and nothing here may advertise a capability the adapter does not already
 * carry under the provider's documented endpoint.
 */
const SUPPORTED_ACTIONS = {
  [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: new Set<HostedSessionActionKind>([
    ACTION_KIND.MESSAGE,
    ACTION_KIND.CONTROL,
    ACTION_KIND.ADD_AGENT,
    ACTION_KIND.RENAME_SESSION,
    ACTION_KIND.RENAME_WORKSPACE,
    ACTION_KIND.CREATE_WORKSPACE,
  ]),
} satisfies Readonly<Record<CloudAgentProviderId, ReadonlySet<HostedSessionActionKind>>>;

/**
 * What a provider that documents no way to do each action is said not to
 * document. The `satisfies` is what makes it total: an action kind added to the
 * vocabulary without a phrase here does not compile.
 */
const ACTION_ABSENCE_PHRASE = {
  [ACTION_KIND.MESSAGE]: "taking a message",
  [ACTION_KIND.CONTROL]: "any session controls",
  [ACTION_KIND.ADD_AGENT]: "starting another agent",
  [ACTION_KIND.RENAME_SESSION]: "renaming a session",
  [ACTION_KIND.RENAME_WORKSPACE]: "renaming a workspace",
  [ACTION_KIND.CREATE_WORKSPACE]: "creating a workspace",
} as const satisfies Readonly<Record<HostedSessionActionKind, string>>;

/**
 * The reason a provider cannot take this action, or undefined for one that can.
 * It answers a fact about the build — this provider documents no such
 * endpoint at all — so the routes ask before requiring a vault key, and the
 * executor asks again before observing anything.
 */
export function actionUnsupportedReason(
  action: HostedSessionActionKind,
  providerId: CloudAgentProviderId,
): string | undefined {
  if (SUPPORTED_ACTIONS[providerId].has(action)) return undefined;
  const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
  return `${displayName} does not document ${ACTION_ABSENCE_PHRASE[action]} through its API, so Luke does not offer it.`;
}

/** What an executed action answers with, in the hosted wire's own vocabulary. */
export interface ActionExecutionAnswer {
  result: ActionResultStatus;
  reason?: string;
  /** For creation-shaped actions: the session id the provider's response named. */
  providerSessionId?: string;
}

export interface ActionExecuteSeams {
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * One plugin observed once for one action: the same re-observe-before-write
 * discipline the desktop keeps in its observation registry, here as a fresh
 * pass on a request-scoped instance. The pass swallows credential and
 * network failures into an empty roster, so the pass watches its own fetch to
 * tell "the provider refused the key" and "the provider could not be reached"
 * apart from "the session is gone" when the action's target is missing.
 */
interface ObservedActionPass {
  plugin: SessionProviderPlugin;
  observations: readonly ProviderSessionObservation[];
  unauthorized: boolean;
  unreachable: boolean;
}

async function passForAction(
  providerId: CloudAgentProviderId,
  apiKey: string,
  seams: ActionExecuteSeams,
): Promise<ObservedActionPass> {
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
  const plugin = cloudSessionPluginFor(providerId, {
    readApiKey: async () => apiKey,
    fetch: watchingFetch,
    ...(seams.now ? { now: seams.now } : undefined),
  });
  const observations = await plugin.observe();
  return { plugin, observations, ...pass };
}

/** Why an action's target was not in the fresh pass, as the user should hear it. */
function missingTargetReason(
  providerId: CloudAgentProviderId,
  pass: Pick<ObservedActionPass, "unauthorized" | "unreachable">,
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
 * action, which the routes and the executor already answered.
 */
function fromProviderResult(
  result: ProviderActionResult | ProviderWorkspaceResult,
): ActionExecutionAnswer {
  if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
    return { result: ACTION_RESULT_STATUS.REJECTED, reason: result.reason };
  }
  const providerSessionId = "providerSessionId" in result ? result.providerSessionId : undefined;
  return {
    result: ACTION_RESULT_STATUS.ACCEPTED,
    ...(providerSessionId ? { providerSessionId } : undefined),
  };
}

/**
 * The roster and the projects admission reads, over the one pass this request
 * ran. Admission is where "the target has to be one the roster holds" is
 * answered, so what it reads is that pass and never a caller's copy of it; the
 * phone's own press is the origin, which is recorded and never a permission.
 */
function admissionOver(pass: ObservedActionPass): AdmitContext {
  const { provider } = pass.plugin;
  return {
    origin: RUN_ORIGIN.USER,
    roster: {
      read: async () => pass.observations.map((one) => normalizeSession(provider, one)),
    },
    projects: {
      read: async () =>
        (pass.plugin.projects?.() ?? []).map((project) => ({
          ...project,
          providerId: provider.id,
          providerName: provider.displayName,
        })),
      // The phone keeps no saved tie-breaks of its own, so an ambiguous ask
      // stays ambiguous rather than being settled by somebody else's default.
      defaults: async () => ({}),
      agentModels: workspaceAgentModels,
    },
  };
}

/**
 * A refusal in this wire's own words. The two that name a target admission
 * could not find travel through {@link missingTargetReason}, because a refused
 * key and an unreachable provider are different facts than a session that
 * moved on; every other refusal is already a sentence the caller can act on,
 * and says something the pass's own failure would drown out.
 */
function missingTargetPhrase(reason: string): string | undefined {
  if (reason === ACTION_REFUSAL.NO_SESSION) return "Session not found.";
  if (reason === ACTION_REFUSAL.NO_PROJECT) return "Project not found.";
  return undefined;
}

function fromRefusal(
  providerId: CloudAgentProviderId,
  pass: ObservedActionPass,
  refusal: Refusal,
): ActionExecutionAnswer {
  const missing = missingTargetPhrase(refusal.reason);
  return {
    result: ACTION_RESULT_STATUS.REJECTED,
    reason: missing ? missingTargetReason(providerId, pass, missing) : refusal.reason,
  };
}

/**
 * One action a remote client asked, admitted and carried. The build's own
 * capability map answers first, before a pass exists; then one fresh
 * observation pass runs, `admit()` reads that pass for itself — the session or
 * the project it names, the advertisement it stands on, the bounds on the
 * developer's own words — and only the validated action it mints reaches the
 * adapter, which builds each effect's route back out of the same pass.
 */
export async function executeSessionAction(options: {
  kind: HostedSessionActionKind;
  providerId: CloudAgentProviderId;
  /** The ask's own fields, keyed by the names admission reads, unparsed. */
  fields: WireRecord;
  apiKey: string;
  seams?: ActionExecuteSeams;
}): Promise<ActionExecutionAnswer> {
  const { kind, providerId, fields, apiKey } = options;
  const unsupported = actionUnsupportedReason(kind, providerId);
  if (unsupported) return { result: ACTION_RESULT_STATUS.UNSUPPORTED, reason: unsupported };

  const pass = await passForAction(providerId, apiKey, options.seams ?? {});
  const request: ActionRequest<HostedSessionActionKind> = { kind, fields };
  const admitted = await admit(request, admissionOver(pass));
  if (admitted.kind === undefined) return fromRefusal(providerId, pass, admitted);

  const { plugin } = pass;
  return dispatchByKind(admitted, {
    [ACTION_KIND.MESSAGE]: async (action) =>
      fromProviderResult(await dispatchAction(plugin, "message", providerSessionMessage(action))),
    [ACTION_KIND.CONTROL]: async (action) =>
      fromProviderResult(await dispatchAction(plugin, "control", providerControlRequest(action))),
    [ACTION_KIND.ADD_AGENT]: async (action) =>
      fromProviderResult(
        await dispatchAction(plugin, "spawnAgent", providerWorkspaceAgentRequest(action)),
      ),
    [ACTION_KIND.RENAME_SESSION]: async (action) =>
      fromProviderResult(
        await dispatchAction(plugin, "renameSession", providerSessionRenameRequest(action)),
      ),
    [ACTION_KIND.RENAME_WORKSPACE]: async (action) =>
      fromProviderResult(
        await dispatchAction(plugin, "renameWorkspace", providerWorkspaceRenameRequest(action)),
      ),
    [ACTION_KIND.CREATE_WORKSPACE]: async (action) =>
      fromProviderResult(
        await dispatchAction(plugin, "createWorkspace", providerWorkspaceRequest(action)),
      ),
  });
}

/**
 * The providers whose adapters carry the documented conversation read,
 * mirroring exactly the `readConversation` seam each desktop adapter
 * implements — the adapter seam is the authority here as it is for actions, so
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
 * its screen: the same fresh-pass discipline every action keeps — the session
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
  seams?: ActionExecuteSeams;
}): Promise<HostedConversationAnswer | ConversationReadRefusal> {
  const { providerId, providerSessionId, afterMessageId, beforeOffset, apiKey } = options;
  if (!providerReadsConversation(providerId)) {
    const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
    return {
      refused: `${displayName} does not document reading a session's conversation through its API, so Luke does not offer it.`,
    };
  }

  const pass = await passForAction(providerId, apiKey, options.seams ?? {});
  const observation = pass.observations.find(
    (candidate) => candidate.providerSessionId === providerSessionId,
  );
  if (!observation) {
    return { refused: missingTargetReason(providerId, pass, "Session not found.") };
  }

  const result = await dispatchConversation(pass.plugin, {
    providerSessionId,
    ...(afterMessageId ? { afterMessageId } : undefined),
    ...(beforeOffset !== undefined ? { beforeOffset } : undefined),
  });
  if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
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
