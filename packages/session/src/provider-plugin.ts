import {
  ACTION_RESULT_STATUS,
  type Admitted,
  reshapeAdmitted,
  UNSUPPORTED_BY_OBSERVATION,
} from "@sidecar/wire";
import type {
  ProviderActionResult,
  ProviderConversationResult,
  ProviderTranscriptResult,
  ProviderTranscriptSinceResult,
  ProviderWorkspaceResult,
} from "./action-results.js";
import {
  ACTION_KIND,
  type AdvertisedControl,
  advertisedActionFor,
  advertisedControl,
} from "./advertised-actions.js";
import type {
  ProviderControlRequest,
  ProviderConversationRequest,
  ProviderSessionMessage,
  ProviderSessionRenameRequest,
  ProviderWorkspaceAgentRequest,
  ProviderWorkspaceRenameRequest,
  ProviderWorkspaceRequest,
} from "./provider-contract.js";
import type { SessionProvider } from "./session-identity.js";
import type { ProviderSessionObservation } from "./session-shape.js";
import type { WorkspaceAgentSelection } from "./workspace-agents.js";
import { WORKSPACE_TASK_SUPPORT, type WorkspaceProject } from "./workspace-projects.js";

/**
 * A provider is a value: what it observes, the roster that pass published, and
 * the actions and reads it actually implements. An absent handler *is* the
 * unsupported answer, so a provider gains an action by naming it — and taking on
 * that action's constraint in the root guide — rather than by overriding a seam
 * on a base class the compiler cannot hold to the same rule.
 */
export interface SessionProviderPlugin {
  readonly provider: SessionProvider;
  /** One read-only pass, which also publishes the roster actions validate against. */
  observe(): Promise<readonly ProviderSessionObservation[]>;
  /** The roster the latest pass published — what every action is re-validated against. */
  latest(): readonly ProviderSessionObservation[];
  /** The projects the latest pass reported, or none. */
  projects?(): readonly WorkspaceProject[];
  readonly actions?: Partial<ActionHandlers>;
  readonly reads?: Partial<ReadHandlers>;
}

/**
 * One action's input: the user's ask, and the target's own latest observation,
 * which is the only place a target may come from.
 */
export interface ActionInput<Request> {
  readonly request: Request;
  readonly observation: ProviderSessionObservation;
}

/**
 * A user-asked creation, in a project the latest pass reported. `project` is
 * the offered project itself, resolved by both the ask's project id and the
 * target it named, because a provider may offer one repository on several
 * hosts and the target is what tells those apart. The agent kind the ask
 * carried rides along for a provider whose creation takes one; whether it is
 * a kind that project permits is the handler's own check, since only the
 * provider knows what its endpoint accepts.
 */
export interface WorkspaceCreationInput {
  readonly project: WorkspaceProject;
  readonly agent?: string;
  readonly name?: string;
  readonly task?: string;
  readonly agentSelection?: WorkspaceAgentSelection;
}

/** Where in a stored transcript a conversation read starts; the observation names the session. */
export type ConversationPage = Omit<ProviderConversationRequest, "providerSessionId">;

/**
 * Every action a plugin performs takes an admitted input, for the same reason an
 * adapter's write does: only `admit()` in `@sidecar/actions` mints one, so a
 * handler cannot be reached by anything that skipped the gauntlet. The reads
 * below take the plain input — a read is not a write and admits nothing.
 */
export interface ActionHandlers {
  message(input: Admitted<ActionInput<{ readonly text: string }>>): Promise<ProviderActionResult>;
  /** The control is the entry the observation advertised, never the caller's copy. */
  control(
    input: Admitted<ActionInput<{ readonly control: AdvertisedControl }>>,
  ): Promise<ProviderActionResult>;
  createWorkspace(input: Admitted<WorkspaceCreationInput>): Promise<ProviderWorkspaceResult>;
  spawnAgent(
    input: Admitted<
      ActionInput<{
        /** The workspace the observation's own `add-agent` advertisement named. */
        readonly spawnTarget: string;
        readonly agent: string;
        readonly name?: string;
        readonly task?: string;
        readonly model?: string;
        readonly effort?: string;
      }>
    >,
  ): Promise<ProviderWorkspaceResult>;
  renameWorkspace(
    input: Admitted<
      ActionInput<{
        /** The workspace the observation's own `rename-workspace` advertisement named. */
        readonly renameTarget: string;
        readonly name: string;
      }>
    >,
  ): Promise<ProviderActionResult>;
  renameSession(
    input: Admitted<ActionInput<{ readonly name: string }>>,
  ): Promise<ProviderActionResult>;
}

export interface ReadHandlers {
  transcript(providerSessionId: string): Promise<ProviderTranscriptResult>;
  transcriptSince(
    providerSessionId: string,
    cursor?: string,
  ): Promise<ProviderTranscriptSinceResult>;
  conversation(input: ActionInput<ConversationPage>): Promise<ProviderConversationResult>;
}

/**
 * The one answer an absent handler and an unobserved target both give. The
 * wording is deliberately the same for both: a caller learns that the latest
 * observation does not support the action, and nothing about which of the two
 * reasons it was.
 */
const unsupportedByObservation = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: UNSUPPORTED_BY_OBSERVATION,
} as const;

const NO_TRANSCRIPT = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "This provider keeps no transcript this build can read.",
} as const;

const NO_CONVERSATION_READ = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "This provider documents no conversation read this build carries.",
} as const;

/** What each action is asked with, before `dispatchAction` resolves its target. */
export interface PluginActionRequests {
  message: ProviderSessionMessage;
  control: ProviderControlRequest;
  createWorkspace: ProviderWorkspaceRequest;
  spawnAgent: ProviderWorkspaceAgentRequest;
  renameWorkspace: ProviderWorkspaceRenameRequest;
  renameSession: ProviderSessionRenameRequest;
}

/** What each action answers with. */
export interface PluginActionResults {
  message: ProviderActionResult;
  control: ProviderActionResult;
  createWorkspace: ProviderWorkspaceResult;
  spawnAgent: ProviderWorkspaceResult;
  renameWorkspace: ProviderActionResult;
  renameSession: ProviderActionResult;
}

export type PluginActionKind = keyof PluginActionRequests;

type ActionDispatchers = {
  [Kind in PluginActionKind]: (
    plugin: SessionProviderPlugin,
    request: PluginActionRequests[Kind],
  ) => Promise<PluginActionResults[Kind]>;
};

function observationFor(
  plugin: SessionProviderPlugin,
  providerSessionId: string,
): ProviderSessionObservation | undefined {
  return plugin.latest().find((candidate) => candidate.providerSessionId === providerSessionId);
}

const ACTION_DISPATCHERS: ActionDispatchers = {
  async message(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    if (!observation) return unsupportedByObservation;
    const handler = plugin.actions?.message;
    if (!handler) return unsupportedByObservation;
    return handler(reshapeAdmitted(request, { request: { text: request.text }, observation }));
  },

  async control(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    // The advertised control — not the caller's copy of it — is what the
    // handler is given, so whatever it targets is the thing the last pass
    // actually saw, and nothing a caller sends can redirect it.
    const advertised = observation && advertisedControl(observation, request.control.id);
    if (!observation || !advertised) return unsupportedByObservation;
    const handler = plugin.actions?.control;
    if (!handler) return unsupportedByObservation;
    return handler(reshapeAdmitted(request, { request: { control: advertised }, observation }));
  },

  async createWorkspace(plugin, request) {
    // The target is part of resolving *which* project, not a field to pass
    // along: a provider may report one repository on several hosts under one
    // project id, and a creation that named a host must land on that host's.
    const project = plugin
      .projects?.()
      .find(
        (candidate) =>
          candidate.providerProjectId === request.providerProjectId &&
          (request.providerTargetId === undefined ||
            candidate.providerTargetId === request.providerTargetId),
      );
    if (!project) return unsupportedByObservation;

    const { name, task } = request;
    // The task is held to the project's own word for it here, because the
    // project is the plugin's own: it comes back off the pass the plugin ran,
    // not out of the ask.
    if (task && project.taskSupport === WORKSPACE_TASK_SUPPORT.NONE) {
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "This project takes no opening task.",
      };
    }
    if (!task && project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "This project needs an opening task to create a workspace.",
      };
    }

    const handler = plugin.actions?.createWorkspace;
    if (!handler) return unsupportedByObservation;
    return handler(
      reshapeAdmitted(request, {
        project,
        ...(request.agent === undefined ? undefined : { agent: request.agent }),
        ...(name === undefined ? undefined : { name }),
        ...(task === undefined ? undefined : { task }),
        ...(request.agentSelection === undefined
          ? undefined
          : { agentSelection: request.agentSelection }),
      }),
    );
  },

  async spawnAgent(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    if (!observation) return unsupportedByObservation;
    // The advertised list — not the caller's word — is what the handler is
    // given, so an agent kind is only ever one the last pass promised.
    const addAgent = advertisedActionFor(observation, ACTION_KIND.ADD_AGENT);
    const agent = addAgent?.agents.find((candidate) => candidate === request.agent);
    if (!addAgent || !agent) return unsupportedByObservation;

    const handler = plugin.actions?.spawnAgent;
    if (!handler) return unsupportedByObservation;
    return handler(
      reshapeAdmitted(request, {
        request: {
          spawnTarget: addAgent.target ?? request.providerSessionId,
          agent,
          ...(request.name === undefined ? undefined : { name: request.name }),
          ...(request.task === undefined ? undefined : { task: request.task }),
          ...(request.model === undefined ? undefined : { model: request.model }),
          ...(request.effort === undefined ? undefined : { effort: request.effort }),
        },
        observation,
      }),
    );
  },

  async renameWorkspace(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    // The advertised target — not the caller's word — is what the handler is
    // given, so a rename only ever lands on the workspace the last pass
    // promised.
    const advertised =
      observation && advertisedActionFor(observation, ACTION_KIND.RENAME_WORKSPACE);
    if (!observation || !advertised) return unsupportedByObservation;

    const handler = plugin.actions?.renameWorkspace;
    if (!handler) return unsupportedByObservation;
    return handler(
      reshapeAdmitted(request, {
        request: { renameTarget: advertised.target, name: request.name },
        observation,
      }),
    );
  },

  async renameSession(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    if (!observation) return unsupportedByObservation;
    const handler = plugin.actions?.renameSession;
    if (!handler) return unsupportedByObservation;
    return handler(reshapeAdmitted(request, { request: { name: request.name }, observation }));
  },
};

/**
 * The only route to an action handler. It resolves every target from the
 * plugin's own latest roster — the advertised control, the `add-agent` and
 * `rename-workspace` targets, and the target's own observation — so an action
 * acts on what the pass saw and never on what a caller sent, and answers
 * unsupported for a session the pass did not report or an action the plugin does
 * not name. Whether the action may run at all was answered before it arrived:
 * only `admit()` mints the request this takes.
 */
export function dispatchAction<Kind extends PluginActionKind>(
  plugin: SessionProviderPlugin,
  kind: Kind,
  request: PluginActionRequests[Kind],
): Promise<PluginActionResults[Kind]> {
  // SAFETY: the table is keyed by the same action kind the request and result
  // types are, so the entry this key selects takes and answers exactly these.
  const dispatch = ACTION_DISPATCHERS[kind] as (
    plugin: SessionProviderPlugin,
    request: PluginActionRequests[Kind],
  ) => Promise<PluginActionResults[Kind]>;
  return dispatch(plugin, request);
}

/**
 * The same dispatch for the two transcript reads. They are guarded by nothing
 * but the plugin naming a handler: a transcript read reaches no provider and
 * performs nothing, and the roster check that decides whether a session may
 * be read at all is the host's, made before the ask arrives here.
 */
export function dispatchRead(
  plugin: SessionProviderPlugin,
  kind: "transcript",
  providerSessionId: string,
): Promise<ProviderTranscriptResult>;
export function dispatchRead(
  plugin: SessionProviderPlugin,
  kind: "transcriptSince",
  providerSessionId: string,
  cursor?: string,
): Promise<ProviderTranscriptSinceResult>;
export async function dispatchRead(
  plugin: SessionProviderPlugin,
  kind: "transcript" | "transcriptSince",
  providerSessionId: string,
  cursor?: string,
): Promise<ProviderTranscriptResult | ProviderTranscriptSinceResult> {
  if (kind === "transcript") {
    const handler = plugin.reads?.transcript;
    return handler ? handler(providerSessionId) : NO_TRANSCRIPT;
  }
  const handler = plugin.reads?.transcriptSince;
  return handler ? handler(providerSessionId, cursor) : NO_TRANSCRIPT;
}

/**
 * The conversation read, dispatched like an action rather than like a transcript
 * read: it reaches the provider, so it exists only for a session the latest
 * pass reported, and the session it names is the observation's own.
 */
export async function dispatchConversation(
  plugin: SessionProviderPlugin,
  request: ProviderConversationRequest,
): Promise<ProviderConversationResult> {
  const observation = observationFor(plugin, request.providerSessionId);
  if (!observation) return unsupportedByObservation;
  const handler = plugin.reads?.conversation;
  if (!handler) return NO_CONVERSATION_READ;
  const { providerSessionId: _named, ...page } = request;
  return handler({ request: page, observation });
}
