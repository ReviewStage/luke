import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type {
  ProviderActResult,
  ProviderConversationResult,
  ProviderTranscriptResult,
  ProviderTranscriptSinceResult,
  ProviderWorkspaceResult,
} from "./act-results.js";
import {
  ACT_KIND,
  type AdvertisedControl,
  advertisedActFor,
  advertisedControl,
} from "./advertised-acts.js";
import { sessionMessageText, workspaceNameText } from "./bounds.js";
import type {
  ProviderControlRequest,
  ProviderConversationRequest,
  ProviderSessionMessage,
  ProviderSessionRenameRequest,
  ProviderWorkspaceAgentRequest,
  ProviderWorkspaceRenameRequest,
  ProviderWorkspaceRequest,
  SessionProviderAdapter,
} from "./provider-contract.js";
import type { CliConnection } from "./provider-identity.js";
import type { SessionProvider } from "./session-identity.js";
import type { ProviderSessionObservation } from "./session-shape.js";
import type { WorkspaceAgentSelection } from "./workspace-agents.js";
import { WORKSPACE_TASK_SUPPORT, type WorkspaceProject } from "./workspace-projects.js";

/**
 * A provider is a value: what it observes, the roster that pass published, and
 * the acts and reads it actually implements. An absent handler *is* the
 * unsupported answer, so a provider gains an act by naming it — and taking on
 * that act's constraint in the root guide — rather than by overriding a seam
 * on a base class the compiler cannot hold to the same rule.
 */
export interface SessionProviderPlugin {
  readonly provider: SessionProvider;
  /** One read-only pass, which also publishes the roster acts validate against. */
  observe(): Promise<readonly ProviderSessionObservation[]>;
  /** The roster the latest pass published — what every act is re-validated against. */
  latest(): readonly ProviderSessionObservation[];
  /** The projects the latest pass reported, or none. */
  projects?(): readonly WorkspaceProject[];
  readonly acts?: Partial<ActHandlers>;
  readonly reads?: Partial<ReadHandlers>;
  /** What the latest pass learned about a CLI login, for a settings row to report. */
  connection?(): CliConnection;
}

/**
 * One act's input: the user's ask, and the target's own latest observation,
 * which is the only place a target may come from.
 */
export interface ActInput<Request> {
  readonly request: Request;
  readonly observation: ProviderSessionObservation;
}

/** A user-asked creation, in a project the latest pass reported. */
export interface WorkspaceCreationInput {
  readonly project: WorkspaceProject;
  readonly name?: string;
  readonly task?: string;
  readonly agentSelection?: WorkspaceAgentSelection;
}

/** Where in a stored transcript a conversation read starts; the observation names the session. */
export type ConversationPage = Omit<ProviderConversationRequest, "providerSessionId">;

export interface ActHandlers {
  message(input: ActInput<{ readonly text: string }>): Promise<ProviderActResult>;
  /** The control is the entry the observation advertised, never the caller's copy. */
  control(input: ActInput<{ readonly control: AdvertisedControl }>): Promise<ProviderActResult>;
  createWorkspace(input: WorkspaceCreationInput): Promise<ProviderWorkspaceResult>;
  spawnAgent(
    input: ActInput<{
      /** The workspace the observation's own `add-agent` advertisement named. */
      readonly spawnTarget: string;
      readonly agent: string;
      readonly name?: string;
      readonly task?: string;
      readonly model?: string;
      readonly effort?: string;
    }>,
  ): Promise<ProviderWorkspaceResult>;
  renameWorkspace(
    input: ActInput<{
      /** The workspace the observation's own `rename-workspace` advertisement named. */
      readonly renameTarget: string;
      readonly name: string;
    }>,
  ): Promise<ProviderActResult>;
  renameSession(input: ActInput<{ readonly name: string }>): Promise<ProviderActResult>;
}

export interface ReadHandlers {
  transcript(providerSessionId: string): Promise<ProviderTranscriptResult>;
  transcriptSince(
    providerSessionId: string,
    cursor?: string,
  ): Promise<ProviderTranscriptSinceResult>;
  conversation(input: ActInput<ConversationPage>): Promise<ProviderConversationResult>;
}

/**
 * Reads a class-shaped adapter as a plugin. Every adapter answers every act
 * through its base class today, so every handler is present and the
 * unsupported answers still come from the adapter's own roster check — which
 * is what lets one suite judge an adapter and the plugin that replaces it by
 * exactly the same tests.
 */
export function adapterAsPlugin(adapter: SessionProviderAdapter): SessionProviderPlugin {
  let observed: readonly ProviderSessionObservation[] = [];
  return {
    provider: adapter.provider,
    async observe() {
      observed = await adapter.observe();
      return observed;
    },
    latest: () => observed,
    projects: () => adapter.workspaceProjects(),
    acts: {
      message: (input) => adapter.sendMessage(ACT_REQUEST_FROM.message(input)),
      control: (input) => adapter.executeControl(ACT_REQUEST_FROM.control(input)),
      createWorkspace: (input) => adapter.createWorkspace(ACT_REQUEST_FROM.createWorkspace(input)),
      spawnAgent: (input) => adapter.spawnWorkspaceAgent(ACT_REQUEST_FROM.spawnAgent(input)),
      renameWorkspace: (input) => adapter.renameWorkspace(ACT_REQUEST_FROM.renameWorkspace(input)),
      renameSession: (input) => adapter.renameSession(ACT_REQUEST_FROM.renameSession(input)),
    },
    reads: {
      transcript: (providerSessionId) => adapter.readTranscript(providerSessionId),
      transcriptSince: (providerSessionId, cursor) =>
        adapter.readTranscriptSince(providerSessionId, cursor),
      conversation: ({ request, observation }) =>
        adapter.readConversation({
          providerSessionId: observation.providerSessionId,
          ...request,
        }),
    },
  };
}

/**
 * The one refusal an absent handler or an unobserved target answers with. It
 * is deliberately the same wording for both: a caller learns that the latest
 * observation does not support the act, and nothing about which of the two
 * reasons it was.
 */
export const UNSUPPORTED_BY_OBSERVATION = "That act is not supported by the latest observation.";

const unsupportedByObservation = {
  status: ACT_RESULT_STATUS.UNSUPPORTED,
  reason: UNSUPPORTED_BY_OBSERVATION,
} as const;

const NO_TRANSCRIPT = {
  status: ACT_RESULT_STATUS.UNSUPPORTED,
  reason: "This provider keeps no transcript this build can read.",
} as const;

const NO_CONVERSATION_READ = {
  status: ACT_RESULT_STATUS.UNSUPPORTED,
  reason: "This provider documents no conversation read this build carries.",
} as const;

/** What each act is asked with, before `dispatchAct` resolves its target. */
export interface PluginActRequests {
  message: ProviderSessionMessage;
  control: ProviderControlRequest;
  createWorkspace: ProviderWorkspaceRequest;
  spawnAgent: ProviderWorkspaceAgentRequest;
  renameWorkspace: ProviderWorkspaceRenameRequest;
  renameSession: ProviderSessionRenameRequest;
}

/** What each act answers with. */
export interface PluginActResults {
  message: ProviderActResult;
  control: ProviderActResult;
  createWorkspace: ProviderWorkspaceResult;
  spawnAgent: ProviderWorkspaceResult;
  renameWorkspace: ProviderActResult;
  renameSession: ProviderActResult;
}

export type PluginActKind = keyof PluginActRequests;

type ActDispatchers = {
  [Kind in PluginActKind]: (
    plugin: SessionProviderPlugin,
    request: PluginActRequests[Kind],
  ) => Promise<PluginActResults[Kind]>;
};

function observationFor(
  plugin: SessionProviderPlugin,
  providerSessionId: string,
): ProviderSessionObservation | undefined {
  return plugin.latest().find((candidate) => candidate.providerSessionId === providerSessionId);
}

const ACT_DISPATCHERS: ActDispatchers = {
  async message(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    if (!observation || !advertisedActFor(observation, ACT_KIND.MESSAGE)) {
      return unsupportedByObservation;
    }
    const text = sessionMessageText(request.text);
    if (!text) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That message is empty or too long." };
    }
    const handler = plugin.acts?.message;
    if (!handler) return unsupportedByObservation;
    return handler({ request: { text }, observation });
  },

  async control(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    // The advertised control — not the caller's copy of it — is what the
    // handler is given, so whatever it targets is the thing the last pass
    // actually saw, and nothing a caller sends can redirect it.
    const advertised = observation && advertisedControl(observation, request.control.id);
    if (!observation || !advertised) return unsupportedByObservation;
    const handler = plugin.acts?.control;
    if (!handler) return unsupportedByObservation;
    return handler({ request: { control: advertised }, observation });
  },

  async createWorkspace(plugin, request) {
    const project = plugin
      .projects?.()
      .find((candidate) => candidate.providerProjectId === request.providerProjectId);
    if (!project) return unsupportedByObservation;

    const name = request.name === undefined ? undefined : workspaceNameText(request.name);
    if (request.name !== undefined && !name) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That workspace name is empty or too long.",
      };
    }
    // The task is held to the project's own word for it, again here: the
    // renderer already refused what it could, but a provider answers for its
    // own writes.
    const task = request.task === undefined ? undefined : sessionMessageText(request.task);
    if (request.task !== undefined && !task) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That task is empty or too long." };
    }
    if (task && project.taskSupport === WORKSPACE_TASK_SUPPORT.NONE) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "This project takes no opening task." };
    }
    if (!task && project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "This project needs an opening task to create a workspace.",
      };
    }

    const handler = plugin.acts?.createWorkspace;
    if (!handler) return unsupportedByObservation;
    return handler({
      project,
      ...(name === undefined ? undefined : { name }),
      ...(task === undefined ? undefined : { task }),
      ...(request.agentSelection === undefined
        ? undefined
        : { agentSelection: request.agentSelection }),
    });
  },

  async spawnAgent(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    if (!observation) return unsupportedByObservation;
    // The advertised list — not the caller's word — is what the handler is
    // given, so an agent kind is only ever one the last pass promised.
    const addAgent = advertisedActFor(observation, ACT_KIND.ADD_AGENT);
    const agent = addAgent?.agents.find((candidate) => candidate === request.agent);
    if (!addAgent || !agent) return unsupportedByObservation;

    const name = request.name === undefined ? undefined : workspaceNameText(request.name);
    if (request.name !== undefined && !name) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That session name is empty or too long.",
      };
    }
    const task = request.task === undefined ? undefined : sessionMessageText(request.task);
    if (request.task !== undefined && !task) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That task is empty or too long." };
    }

    const handler = plugin.acts?.spawnAgent;
    if (!handler) return unsupportedByObservation;
    return handler({
      request: {
        spawnTarget: addAgent.target ?? request.providerSessionId,
        agent,
        ...(name === undefined ? undefined : { name }),
        ...(task === undefined ? undefined : { task }),
        ...(request.model === undefined ? undefined : { model: request.model }),
        ...(request.effort === undefined ? undefined : { effort: request.effort }),
      },
      observation,
    });
  },

  async renameWorkspace(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    // The advertised target — not the caller's word — is what the handler is
    // given, so a rename only ever lands on the workspace the last pass
    // promised.
    const advertised = observation && advertisedActFor(observation, ACT_KIND.RENAME_WORKSPACE);
    if (!observation || !advertised) return unsupportedByObservation;

    const name = workspaceNameText(request.name);
    if (!name) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That workspace name is empty or too long.",
      };
    }

    const handler = plugin.acts?.renameWorkspace;
    if (!handler) return unsupportedByObservation;
    return handler({ request: { renameTarget: advertised.target, name }, observation });
  },

  async renameSession(plugin, request) {
    const observation = observationFor(plugin, request.providerSessionId);
    if (!observation || !advertisedActFor(observation, ACT_KIND.RENAME_SESSION)) {
      return unsupportedByObservation;
    }

    const name = workspaceNameText(request.name);
    if (!name) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That session name is empty or too long.",
      };
    }

    const handler = plugin.acts?.renameSession;
    if (!handler) return unsupportedByObservation;
    return handler({ request: { name }, observation });
  },
};

/**
 * The ask each act's handler input was built from. `dispatchAct` resolves an
 * ask into a handler input; a caller holding the input and needing the ask
 * again — an adapter behind a plugin, or one of several observers being asked
 * in turn — reads it back through here, so the two directions cannot drift.
 */
export type ActRequestFrom = {
  [Kind in PluginActKind]: (input: Parameters<ActHandlers[Kind]>[0]) => PluginActRequests[Kind];
};

export const ACT_REQUEST_FROM: ActRequestFrom = {
  message: ({ request, observation }) => ({
    providerSessionId: observation.providerSessionId,
    text: request.text,
  }),
  control: ({ request, observation }) => ({
    providerSessionId: observation.providerSessionId,
    control: request.control,
  }),
  createWorkspace: (input) => ({
    providerProjectId: input.project.providerProjectId,
    ...(input.name === undefined ? undefined : { name: input.name }),
    ...(input.task === undefined ? undefined : { task: input.task }),
    ...(input.agentSelection === undefined ? undefined : { agentSelection: input.agentSelection }),
  }),
  spawnAgent: ({ request, observation }) => ({
    providerSessionId: observation.providerSessionId,
    agent: request.agent,
    ...(request.name === undefined ? undefined : { name: request.name }),
    ...(request.task === undefined ? undefined : { task: request.task }),
    ...(request.model === undefined ? undefined : { model: request.model }),
    ...(request.effort === undefined ? undefined : { effort: request.effort }),
  }),
  renameWorkspace: ({ request, observation }) => ({
    providerSessionId: observation.providerSessionId,
    name: request.name,
  }),
  renameSession: ({ request, observation }) => ({
    providerSessionId: observation.providerSessionId,
    name: request.name,
  }),
};

/**
 * The only route to an act handler. It resolves every target from the
 * plugin's own latest roster — the advertised control, the `add-agent` and
 * `rename-workspace` targets, and the target's own observation — so an act
 * acts on what the pass saw and never on what a caller sent, holds the ask to
 * its bound, and answers unsupported for a session the pass did not report or
 * an act the plugin does not name.
 */
export function dispatchAct<Kind extends PluginActKind>(
  plugin: SessionProviderPlugin,
  kind: Kind,
  request: PluginActRequests[Kind],
): Promise<PluginActResults[Kind]> {
  // SAFETY: the table is keyed by the same act kind the request and result
  // types are, so the entry this key selects takes and answers exactly these.
  const dispatch = ACT_DISPATCHERS[kind] as (
    plugin: SessionProviderPlugin,
    request: PluginActRequests[Kind],
  ) => Promise<PluginActResults[Kind]>;
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
 * The conversation read, dispatched like an act rather than like a transcript
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

/**
 * Reads a plugin as the class-shaped adapter the host's seams still take, so
 * a provider can become a plugin one at a time. It is the inverse of
 * {@link adapterAsPlugin} and lives exactly as long as
 * `SessionProviderAdapter` does.
 */
export function pluginAsAdapter(plugin: SessionProviderPlugin): SessionProviderAdapter {
  return {
    provider: plugin.provider,
    observe: () => plugin.observe(),
    workspaceProjects: () => plugin.projects?.() ?? [],
    sendMessage: (message) => dispatchAct(plugin, "message", message),
    executeControl: (request) => dispatchAct(plugin, "control", request),
    createWorkspace: (request) => dispatchAct(plugin, "createWorkspace", request),
    spawnWorkspaceAgent: (request) => dispatchAct(plugin, "spawnAgent", request),
    renameWorkspace: (request) => dispatchAct(plugin, "renameWorkspace", request),
    renameSession: (request) => dispatchAct(plugin, "renameSession", request),
    readTranscript: (providerSessionId) => dispatchRead(plugin, "transcript", providerSessionId),
    readTranscriptSince: (providerSessionId, cursor) =>
      dispatchRead(plugin, "transcriptSince", providerSessionId, cursor),
    readConversation: (request) => dispatchConversation(plugin, request),
  };
}

/**
 * One provider observed in more than one place — sessions on this machine and
 * the same provider's sessions in its cloud. The registry replaces a
 * provider's sessions in a single commit, so observers that share a provider
 * id have to arrive as one plugin: registered separately, each pass would
 * retire the other's sessions.
 */
export function mergePlugins(
  provider: SessionProvider,
  plugins: readonly SessionProviderPlugin[],
): SessionProviderPlugin {
  for (const plugin of plugins) {
    // Observing one provider's sessions under another's identity is a wiring
    // mistake rather than something a user can correct.
    if (plugin.provider.id !== provider.id) {
      throw new Error(`Merged plugin for ${provider.id} cannot observe ${plugin.provider.id}`);
    }
  }

  /**
   * Asks each observer in turn. Unsupported means this observer has never
   * seen the subject, so the question moves on; any firm answer is the
   * subject's own and ends the search.
   */
  const firstFirmAnswer = async <Result extends { status: string }>(
    ask: (plugin: SessionProviderPlugin) => Promise<Result>,
    exhausted: Result,
  ): Promise<Result> => {
    for (const plugin of plugins) {
      const result = await ask(plugin);
      if (result.status !== ACT_RESULT_STATUS.UNSUPPORTED) return result;
    }
    return exhausted;
  };

  const merged = (
    collected: readonly (readonly ProviderSessionObservation[])[],
  ): readonly ProviderSessionObservation[] => {
    const observations = new Map<string, ProviderSessionObservation>();
    // A session two observers both reached is still one session, and the
    // registry rejects a snapshot that names one twice.
    for (const observation of collected.flat()) {
      if (!observations.has(observation.providerSessionId)) {
        observations.set(observation.providerSessionId, observation);
      }
    }
    return [...observations.values()];
  };

  const exhausted = {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "No provider observer supports that act.",
  } as const;

  /** One act, asked of each observer in turn with the ask it was built from. */
  const askEach = <Kind extends PluginActKind>(
    kind: Kind,
    input: Parameters<ActHandlers[Kind]>[0],
  ): Promise<PluginActResults[Kind]> =>
    firstFirmAnswer<PluginActResults[Kind]>(
      (plugin) => dispatchAct(plugin, kind, ACT_REQUEST_FROM[kind](input)),
      exhausted,
    );

  return {
    provider,

    /**
     * A pass fails whole. The registry commits a provider snapshot entire, so
     * reporting the observers that answered would retire every session
     * belonging to the one that did not, and the panel would lose them until
     * it recovers.
     */
    async observe() {
      return merged(await Promise.all(plugins.map((plugin) => plugin.observe())));
    },

    latest: () => merged(plugins.map((plugin) => plugin.latest())),

    /** Every project any observer offered, in the order the observers stand in. */
    projects: () => plugins.flatMap((plugin) => plugin.projects?.() ?? []),

    acts: {
      message: (input) => askEach("message", input),
      control: (input) => askEach("control", input),
      createWorkspace: (input) => askEach("createWorkspace", input),
      spawnAgent: (input) => askEach("spawnAgent", input),
      renameWorkspace: (input) => askEach("renameWorkspace", input),
      renameSession: (input) => askEach("renameSession", input),
    },

    reads: {
      transcript: (providerSessionId) =>
        firstFirmAnswer<ProviderTranscriptResult>(
          (plugin) => dispatchRead(plugin, "transcript", providerSessionId),
          exhausted,
        ),
      transcriptSince: (providerSessionId, cursor) =>
        firstFirmAnswer<ProviderTranscriptSinceResult>(
          (plugin) => dispatchRead(plugin, "transcriptSince", providerSessionId, cursor),
          exhausted,
        ),
      conversation: (input) =>
        firstFirmAnswer<ProviderConversationResult>(
          (plugin) =>
            dispatchConversation(plugin, {
              providerSessionId: input.observation.providerSessionId,
              ...input.request,
            }),
          exhausted,
        ),
    },
  };
}
