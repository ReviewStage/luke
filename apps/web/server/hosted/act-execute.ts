import {
  ACT_KIND,
  ACT_REFUSAL,
  ACT_RESULT_STATUS,
  type ActRequest,
  type ActResultStatus,
  type AdmitContext,
  admit,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type CloudFetch,
  dispatchByKind,
  type HostedConversationAnswer,
  type HostedConversationMessage,
  normalizeSession,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderActResult,
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
  type SessionActKind,
  type SessionProviderAdapter,
  type WireRecord,
  workspaceAgentModels,
} from "../core.js";
import { cloudSessionAdapterFor } from "./cloud-adapters.js";

/**
 * The acts a remote client can ask of a cloud session: the session act kinds
 * this build's own act vocabulary names, less the open, which is not a write
 * and reaches no endpoint. One vocabulary for the capability map below, for
 * every route that names an act, and for admission, so a route cannot invent
 * an act the map does not govern or admission does not know.
 */
export type HostedSessionActKind = Exclude<SessionActKind, typeof ACT_KIND.OPEN>;

/**
 * Which acts each provider takes, mirroring exactly the write routes its
 * desktop adapter implements — the adapter seam is the authority for acts,
 * and nothing here may advertise a capability the adapter does not already
 * carry under the provider's documented endpoint.
 */
const SUPPORTED_ACTS = {
  [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: new Set<HostedSessionActKind>([
    ACT_KIND.MESSAGE,
    ACT_KIND.CONTROL,
    ACT_KIND.ADD_AGENT,
    ACT_KIND.RENAME_SESSION,
    ACT_KIND.RENAME_WORKSPACE,
    ACT_KIND.CREATE_WORKSPACE,
  ]),
} satisfies Readonly<Record<CloudAgentProviderId, ReadonlySet<HostedSessionActKind>>>;

/**
 * What a provider that documents no way to do each act is said not to
 * document. The `satisfies` is what makes it total: an act kind added to the
 * vocabulary without a phrase here does not compile.
 */
const ACT_ABSENCE_PHRASE = {
  [ACT_KIND.MESSAGE]: "taking a message",
  [ACT_KIND.CONTROL]: "any session controls",
  [ACT_KIND.ADD_AGENT]: "starting another agent",
  [ACT_KIND.RENAME_SESSION]: "renaming a session",
  [ACT_KIND.RENAME_WORKSPACE]: "renaming a workspace",
  [ACT_KIND.CREATE_WORKSPACE]: "creating a workspace",
} as const satisfies Readonly<Record<HostedSessionActKind, string>>;

/**
 * The reason a provider cannot take this act, or undefined for one that can.
 * It answers a fact about the build — this provider documents no such
 * endpoint at all — so the routes ask before requiring a vault key, and the
 * executor asks again before observing anything.
 */
export function actUnsupportedReason(
  act: HostedSessionActKind,
  providerId: CloudAgentProviderId,
): string | undefined {
  if (SUPPORTED_ACTS[providerId].has(act)) return undefined;
  const displayName = PROVIDER_IDENTITY_BY_ID[providerId].displayName;
  return `${displayName} does not document ${ACT_ABSENCE_PHRASE[act]} through its API, so Luke does not offer it.`;
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
 * act, which the routes and the executor already answered.
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

/**
 * The roster and the projects admission reads, over the one pass this request
 * ran. Admission is where "the target has to be one the roster holds" is
 * answered, so what it reads is that pass and never a caller's copy of it; the
 * phone's own press is the origin, which is recorded and never a permission.
 */
function admissionOver(pass: ObservedActPass): AdmitContext {
  const { provider } = pass.adapter;
  return {
    origin: RUN_ORIGIN.USER,
    roster: {
      read: async () => pass.observations.map((one) => normalizeSession(provider, one)),
    },
    projects: {
      read: async () =>
        pass.adapter.workspaceProjects().map((project) => ({
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
  if (reason === ACT_REFUSAL.NO_SESSION) return "Session not found.";
  if (reason === ACT_REFUSAL.NO_PROJECT) return "Project not found.";
  return undefined;
}

function fromRefusal(
  providerId: CloudAgentProviderId,
  pass: ObservedActPass,
  refusal: Refusal,
): ActExecutionAnswer {
  const missing = missingTargetPhrase(refusal.reason);
  return {
    result: ACT_RESULT_STATUS.REJECTED,
    reason: missing ? missingTargetReason(providerId, pass, missing) : refusal.reason,
  };
}

/**
 * One act a remote client asked, admitted and carried. The build's own
 * capability map answers first, before a pass exists; then one fresh
 * observation pass runs, `admit()` reads that pass for itself — the session or
 * the project it names, the advertisement it stands on, the bounds on the
 * developer's own words — and only the validated act it mints reaches the
 * adapter, which builds each effect's route back out of the same pass.
 */
export async function executeSessionAct(options: {
  kind: HostedSessionActKind;
  providerId: CloudAgentProviderId;
  /** The ask's own fields, keyed by the names admission reads, unparsed. */
  fields: WireRecord;
  apiKey: string;
  seams?: ActExecuteSeams;
}): Promise<ActExecutionAnswer> {
  const { kind, providerId, fields, apiKey } = options;
  const unsupported = actUnsupportedReason(kind, providerId);
  if (unsupported) return { result: ACT_RESULT_STATUS.UNSUPPORTED, reason: unsupported };

  const pass = await observeForAct(providerId, apiKey, options.seams ?? {});
  const request: ActRequest<HostedSessionActKind> = { kind, fields };
  const admitted = await admit(request, admissionOver(pass));
  if (admitted.kind === undefined) return fromRefusal(providerId, pass, admitted);

  const { adapter } = pass;
  return dispatchByKind(admitted, {
    [ACT_KIND.MESSAGE]: async (act) =>
      fromProviderResult(await adapter.sendMessage(providerSessionMessage(act))),
    [ACT_KIND.CONTROL]: async (act) =>
      fromProviderResult(await adapter.executeControl(providerControlRequest(act))),
    [ACT_KIND.ADD_AGENT]: async (act) =>
      fromProviderResult(await adapter.spawnWorkspaceAgent(providerWorkspaceAgentRequest(act))),
    [ACT_KIND.RENAME_SESSION]: async (act) =>
      fromProviderResult(await adapter.renameSession(providerSessionRenameRequest(act))),
    [ACT_KIND.RENAME_WORKSPACE]: async (act) =>
      fromProviderResult(await adapter.renameWorkspace(providerWorkspaceRenameRequest(act))),
    [ACT_KIND.CREATE_WORKSPACE]: async (act) =>
      fromProviderResult(await adapter.createWorkspace(providerWorkspaceRequest(act))),
  });
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
