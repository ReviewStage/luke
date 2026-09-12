import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as HttpClient from "@effect/platform/HttpClient";
import { Effect, Layer } from "effect";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  ACTION_RESULT_STATUS,
  type ActionRequest,
  type ActionResultStatus,
  type AdmitContext,
  type AdmitRefusal,
  admitEffect,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  dispatchAction,
  dispatchByKind,
  dispatchConversation,
  type HostedConversationAnswer,
  type HostedConversationMessage,
  HTTP_STATUS,
  normalizeSession,
  type PluginActionKind,
  type PluginActionRequests,
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
  RUN_ORIGIN,
  type SessionActionKind,
  type SessionProviderPlugin,
  type WireRecord,
  type WorkspaceProject,
  workspaceAgentModels,
} from "../core.js";
import { cloudSessionPluginFor } from "./cloud-adapters.js";
import { CLOUD_OBSERVE_FAILURE, type CloudObserveFailure } from "./cloud-observe.js";
import { type ObservedRoster, rosterProvider } from "./observed-roster.js";

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
  /** Injected in tests; production uses the platform's own fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  now?: () => number;
}

/**
 * The roster an action is admitted against: one provider's slice of the
 * stored snapshot, or what the pass that would have seeded it came to. The
 * two flags say why the roster may be empty — the provider refused the key,
 * or could not be reached — so a target admission cannot find is named for
 * what actually happened rather than as a session that moved on.
 */
export interface ActionRoster {
  observations: readonly ProviderSessionObservation[];
  projects: readonly WorkspaceProject[];
  unauthorized: boolean;
  unreachable: boolean;
}

/**
 * One provider's slice of a roster for admission: the stored snapshot's when
 * one stands, and otherwise the empty roster a failed seeding pass left,
 * flagged with why. A snapshot that holds nothing for the provider is a
 * provider the user's keys never opened, which admission reads as no
 * session rather than as a failure.
 */
export function actionRosterFor(
  providerId: CloudAgentProviderId,
  standing: { roster?: ObservedRoster; failure?: CloudObserveFailure },
): ActionRoster {
  const slice = standing.roster ? rosterProvider(standing.roster, providerId) : undefined;
  if (slice) {
    return {
      observations: slice.observations,
      projects: slice.projects,
      unauthorized: false,
      unreachable: false,
    };
  }
  const unauthorized = standing.failure === CLOUD_OBSERVE_FAILURE.UNAUTHORIZED;
  return {
    observations: [],
    projects: [],
    unauthorized,
    unreachable: !unauthorized && standing.failure !== undefined,
  };
}

/**
 * One plugin observed once for one conversation read: the same
 * re-observe-before-read discipline the desktop keeps in its observation
 * registry, here as a fresh pass on a request-scoped instance. The pass
 * swallows credential and network failures into an empty roster, so the pass
 * watches its own client to tell "the provider refused the key" and "the
 * provider could not be reached" apart from "the session is gone" when the
 * read's target is missing.
 */
interface ObservedActionPass {
  plugin: SessionProviderPlugin;
  observations: readonly ProviderSessionObservation[];
  unauthorized: boolean;
  unreachable: boolean;
}

/**
 * The same client the pass would have used, reporting to `pass` what it saw:
 * a refused status is the provider refusing the key, and a failed request is
 * the provider not being reachable. It only watches — every answer and every
 * failure is handed on exactly as it came.
 */
function watchingHttpClient(
  base: Layer.Layer<HttpClient.HttpClient>,
  pass: { unauthorized: boolean; unreachable: boolean },
): Layer.Layer<HttpClient.HttpClient> {
  return Layer.provide(
    Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        HttpClient.tapError(
          HttpClient.tap(client, (response) =>
            Effect.sync(() => {
              if (
                response.status === HTTP_STATUS.UNAUTHORIZED ||
                response.status === HTTP_STATUS.FORBIDDEN
              ) {
                pass.unauthorized = true;
              }
            }),
          ),
          () =>
            Effect.sync(() => {
              pass.unreachable = true;
            }),
        ),
      ),
    ),
    base,
  );
}

async function observeForAction(
  providerId: CloudAgentProviderId,
  apiKey: string,
  seams: ActionExecuteSeams,
): Promise<ObservedActionPass> {
  const pass = { unauthorized: false, unreachable: false };
  const plugin = cloudSessionPluginFor(providerId, {
    readApiKey: async () => apiKey,
    httpClient: watchingHttpClient(seams.httpClient ?? FetchHttpClient.layer, pass),
    ...(seams.now ? { now: seams.now } : undefined),
  });
  const observations = await plugin.observe();
  return { plugin, observations, ...pass };
}

/**
 * The plugin an action is dispatched through, answering for the roster the
 * action was admitted against. `dispatchAction` resolves every target from
 * the plugin's own latest roster, so the plugin built for this one write
 * reads the snapshot's observations and projects as its own latest pass, and
 * every effect's route is built out of the same roster the user was shown.
 */
function pluginOverRoster(
  providerId: CloudAgentProviderId,
  apiKey: string,
  roster: ActionRoster,
  seams: ActionExecuteSeams,
): SessionProviderPlugin {
  const plugin = cloudSessionPluginFor(providerId, {
    readApiKey: async () => apiKey,
    ...(seams.httpClient ? { httpClient: seams.httpClient } : undefined),
    ...(seams.now ? { now: seams.now } : undefined),
  });
  return {
    ...plugin,
    latest: () => roster.observations,
    projects: () => roster.projects,
  };
}

/** Why an action's target was not in the roster, as the user should hear it. */
function missingTargetReason(
  providerId: CloudAgentProviderId,
  pass: Pick<ActionRoster, "unauthorized" | "unreachable">,
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
 * The roster and the projects admission reads, over the snapshot this action
 * stands on. Admission is where "the target has to be one the roster holds"
 * is answered, so what it reads is that roster and never a caller's copy of
 * it; the phone's own press is the origin, which is recorded and never a
 * permission.
 */
function admissionOver(plugin: SessionProviderPlugin, roster: ActionRoster): AdmitContext {
  const { provider } = plugin;
  return {
    origin: RUN_ORIGIN.USER,
    roster: {
      read: () => Effect.succeed(roster.observations.map((one) => normalizeSession(provider, one))),
    },
    projects: {
      read: () =>
        Effect.succeed(
          roster.projects.map((project) => ({
            ...project,
            providerId: provider.id,
            providerName: provider.displayName,
          })),
        ),
      // The phone keeps no saved tie-breaks of its own, so an ambiguous ask
      // stays ambiguous rather than being settled by somebody else's default.
      defaults: () => Effect.succeed({}),
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
  pass: Pick<ActionRoster, "unauthorized" | "unreachable">,
  refusal: AdmitRefusal,
): ActionExecutionAnswer {
  const missing = missingTargetPhrase(refusal.reason);
  return {
    result: ACTION_RESULT_STATUS.REJECTED,
    reason: missing ? missingTargetReason(providerId, pass, missing) : refusal.reason,
  };
}

/**
 * One action a remote client asked, admitted and carried, as the effect the
 * caller composes into its own. The build's own capability map answers first;
 * then `admitEffect()` reads the roster the action stands on for itself — the
 * stored snapshot's slice for this provider, the session or the project it
 * names, the advertisement it stands on, the bounds on the developer's own
 * words — and only the validated action it mints reaches the adapter, which
 * builds each effect's route back out of the same roster. No pass runs here:
 * the snapshot is what the user was shown, and the provider answers for
 * whether the target still stands.
 */
export function executeSessionAction(options: {
  kind: HostedSessionActionKind;
  providerId: CloudAgentProviderId;
  /** The ask's own fields, keyed by the names admission reads, unparsed. */
  fields: WireRecord;
  apiKey: string;
  roster: ActionRoster;
  seams?: ActionExecuteSeams;
}): Effect.Effect<ActionExecutionAnswer> {
  return Effect.suspend(() => {
    const { kind, providerId, fields, apiKey, roster } = options;
    const unsupported = actionUnsupportedReason(kind, providerId);
    if (unsupported) {
      return Effect.succeed<ActionExecutionAnswer>({
        result: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: unsupported,
      });
    }

    const plugin = pluginOverRoster(providerId, apiKey, roster, options.seams ?? {});
    const request: ActionRequest<HostedSessionActionKind> = { kind, fields };
    const carried = <Kind extends PluginActionKind>(
      name: Kind,
      ask: PluginActionRequests[Kind],
    ): Effect.Effect<ActionExecutionAnswer> =>
      Effect.map(
        Effect.promise(() => dispatchAction(plugin, name, ask)),
        fromProviderResult,
      );

    return admitEffect(request, admissionOver(plugin, roster)).pipe(
      Effect.flatMap(
        (admitted): Effect.Effect<ActionExecutionAnswer> =>
          dispatchByKind(admitted, {
            [ACTION_KIND.MESSAGE]: (action) => carried("message", providerSessionMessage(action)),
            [ACTION_KIND.CONTROL]: (action) => carried("control", providerControlRequest(action)),
            [ACTION_KIND.ADD_AGENT]: (action) =>
              carried("spawnAgent", providerWorkspaceAgentRequest(action)),
            [ACTION_KIND.RENAME_SESSION]: (action) =>
              carried("renameSession", providerSessionRenameRequest(action)),
            [ACTION_KIND.RENAME_WORKSPACE]: (action) =>
              carried("renameWorkspace", providerWorkspaceRenameRequest(action)),
            [ACTION_KIND.CREATE_WORKSPACE]: (action) =>
              carried("createWorkspace", providerWorkspaceRequest(action)),
          }),
      ),
      Effect.catchTag("AdmitRefusal", (refusal) =>
        Effect.succeed(fromRefusal(providerId, roster, refusal)),
      ),
    );
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

  const pass = await observeForAction(providerId, apiKey, options.seams ?? {});
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
