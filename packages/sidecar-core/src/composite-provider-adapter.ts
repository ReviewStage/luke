import {
  type ControllableSessionProviderAdapter,
  isControllableAdapter,
  isMessageCapableAdapter,
  isWorkspaceAgentCapableAdapter,
  isWorkspaceCapableAdapter,
  type MessageCapableSessionProviderAdapter,
  PROVIDER_CONTROL_RESULT_STATUS,
  PROVIDER_MESSAGE_RESULT_STATUS,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  type SessionProviderAdapter,
  type WorkspaceAgentCapableSessionProviderAdapter,
  type WorkspaceCapableSessionProviderAdapter,
  type WorkspaceProject,
} from "./providers";
import type { ProviderSessionObservation, SessionProvider } from "./session";

export interface CompositeProviderAdapterOptions {
  provider: SessionProvider;
  /** Observed in order, which is also the order that settles a repeated session. */
  adapters: readonly SessionProviderAdapter[];
}

/**
 * One provider observed in more than one place — sessions on this machine and
 * the same provider's sessions in its cloud. The registry replaces a provider's
 * sessions in a single commit, so observers that share a provider id have to
 * arrive as one adapter: registered separately, each pass would retire the
 * other's sessions.
 */
export class CompositeSessionProviderAdapter
  implements
    SessionProviderAdapter,
    MessageCapableSessionProviderAdapter,
    ControllableSessionProviderAdapter,
    WorkspaceCapableSessionProviderAdapter,
    WorkspaceAgentCapableSessionProviderAdapter
{
  readonly provider: SessionProvider;

  readonly #adapters: readonly SessionProviderAdapter[];

  constructor(options: CompositeProviderAdapterOptions) {
    for (const adapter of options.adapters) {
      // Observing one provider's sessions under another's identity is a wiring
      // mistake rather than something a user can correct.
      if (adapter.provider.id !== options.provider.id) {
        throw new Error(
          `Composite adapter for ${options.provider.id} cannot observe ${adapter.provider.id}`,
        );
      }
    }
    this.provider = options.provider;
    this.#adapters = options.adapters;
  }

  /**
   * A pass fails whole. The registry commits a provider snapshot entire, so
   * reporting the observers that answered would retire every session belonging
   * to the one that did not, and the panel would lose them until it recovers.
   */
  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const collected = await Promise.all(this.#adapters.map((adapter) => adapter.observe()));
    const observations = new Map<string, ProviderSessionObservation>();
    // A session two observers both reached is still one session, and the
    // registry rejects a snapshot that names one twice.
    for (const observation of collected.flat()) {
      if (!observations.has(observation.providerSessionId)) {
        observations.set(observation.providerSessionId, observation);
      }
    }
    return [...observations.values()];
  }

  /**
   * A message goes to whichever observer holds the session. Observers are asked
   * in the order they observe in, and one that answers unsupported has merely
   * never seen the session — its provider's sessions in the other place are
   * still reachable — so the question moves on rather than settling. Any firm
   * answer, accepted or rejected, is the session's own and ends the search.
   */
  async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    for (const adapter of this.#adapters) {
      if (!isMessageCapableAdapter(adapter)) continue;
      const result = await adapter.sendMessage(message);
      if (result.status !== PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED) return result;
    }
    return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
  }

  /** A control finds its observer the same way a message does. */
  async executeControl(request: ProviderControlRequest): Promise<ProviderControlResult> {
    for (const adapter of this.#adapters) {
      if (!isControllableAdapter(adapter)) continue;
      const result = await adapter.executeControl(request);
      if (result.status !== PROVIDER_CONTROL_RESULT_STATUS.UNSUPPORTED) return result;
    }
    return { status: PROVIDER_CONTROL_RESULT_STATUS.UNSUPPORTED };
  }

  /** Every project any observer offered, in the order the observers stand in. */
  workspaceProjects(): readonly WorkspaceProject[] {
    return this.#adapters.flatMap((adapter) =>
      isWorkspaceCapableAdapter(adapter) ? adapter.workspaceProjects() : [],
    );
  }

  /**
   * A creation ask finds its observer the way a message does: an observer that
   * answers unsupported never offered the project, so the question moves on,
   * and any firm answer is the project's own and ends the search.
   */
  async createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    for (const adapter of this.#adapters) {
      if (!isWorkspaceCapableAdapter(adapter)) continue;
      const result = await adapter.createWorkspace(request);
      if (result.status !== PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED) return result;
    }
    return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
  }

  /** A new agent finds the observer holding its workspace the same way. */
  async spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Promise<ProviderWorkspaceResult> {
    for (const adapter of this.#adapters) {
      if (!isWorkspaceAgentCapableAdapter(adapter)) continue;
      const result = await adapter.spawnWorkspaceAgent(request);
      if (result.status !== PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED) return result;
    }
    return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
  }
}
