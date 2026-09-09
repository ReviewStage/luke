import type {
  ProviderActResult,
  ProviderConversationResult,
  ProviderTranscriptResult,
  ProviderTranscriptSinceResult,
  ProviderWorkspaceResult,
} from "./act-results.js";
import type { AdvertisedControl } from "./advertised-acts.js";
import type { ProviderConversationRequest, SessionProviderAdapter } from "./provider-contract.js";
import type { CliConnection } from "./provider-identity.js";
import type { SessionProvider } from "./session-identity.js";
import type { ProviderSessionObservation } from "./session-shape.js";
import type { WorkspaceAgentSelection } from "./workspace-agents.js";
import type { WorkspaceProject } from "./workspace-projects.js";

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
      readonly agent: string;
      readonly name?: string;
      readonly task?: string;
      readonly model?: string;
      readonly effort?: string;
    }>,
  ): Promise<ProviderWorkspaceResult>;
  renameWorkspace(input: ActInput<{ readonly name: string }>): Promise<ProviderActResult>;
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
      message: ({ request, observation }) =>
        adapter.sendMessage({
          providerSessionId: observation.providerSessionId,
          text: request.text,
        }),
      control: ({ request, observation }) =>
        adapter.executeControl({
          providerSessionId: observation.providerSessionId,
          control: request.control,
        }),
      createWorkspace: (input) =>
        adapter.createWorkspace({
          providerProjectId: input.project.providerProjectId,
          ...(input.name === undefined ? undefined : { name: input.name }),
          ...(input.task === undefined ? undefined : { task: input.task }),
          ...(input.agentSelection === undefined
            ? undefined
            : { agentSelection: input.agentSelection }),
        }),
      spawnAgent: ({ request, observation }) =>
        adapter.spawnWorkspaceAgent({
          providerSessionId: observation.providerSessionId,
          agent: request.agent,
          ...(request.name === undefined ? undefined : { name: request.name }),
          ...(request.task === undefined ? undefined : { task: request.task }),
          ...(request.model === undefined ? undefined : { model: request.model }),
          ...(request.effort === undefined ? undefined : { effort: request.effort }),
        }),
      renameWorkspace: ({ request, observation }) =>
        adapter.renameWorkspace({
          providerSessionId: observation.providerSessionId,
          name: request.name,
        }),
      renameSession: ({ request, observation }) =>
        adapter.renameSession({
          providerSessionId: observation.providerSessionId,
          name: request.name,
        }),
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
