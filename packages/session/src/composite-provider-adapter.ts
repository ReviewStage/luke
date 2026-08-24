import { ACT_RESULT_STATUS } from "@sidecar/wire";
import {
  type ProviderActResult,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionRenameRequest,
  type ProviderTranscriptResult,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRenameRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  type SessionProviderAdapter,
  SessionProviderAdapterBase,
  type WorkspaceProject,
} from "./providers.js";
import type { ProviderSessionObservation, SessionProvider } from "./session.js";

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
export class CompositeSessionProviderAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider;

  readonly #adapters: readonly SessionProviderAdapter[];

  constructor(options: CompositeProviderAdapterOptions) {
    super();
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
  override async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    return this.#dispatchAct((adapter) => adapter.sendMessage(message));
  }

  /** A control finds its observer the same way a message does. */
  override async executeControl(request: ProviderControlRequest): Promise<ProviderControlResult> {
    return this.#dispatchAct((adapter) => adapter.executeControl(request));
  }

  /** Every project any observer offered, in the order the observers stand in. */
  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#adapters.flatMap((adapter) => adapter.workspaceProjects());
  }

  /**
   * A creation ask finds its observer the way a message does: an observer that
   * answers unsupported never offered the project, so the question moves on,
   * and any firm answer is the project's own and ends the search.
   */
  override async createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Promise<ProviderWorkspaceResult> {
    return this.#dispatchAct((adapter) => adapter.createWorkspace(request));
  }

  /** A new agent finds the observer holding its workspace the same way. */
  override async spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Promise<ProviderWorkspaceResult> {
    return this.#dispatchAct((adapter) => adapter.spawnWorkspaceAgent(request));
  }

  /** A rename finds the observer holding its workspace the same way. */
  override async renameWorkspace(
    request: ProviderWorkspaceRenameRequest,
  ): Promise<ProviderActResult> {
    return this.#dispatchAct((adapter) => adapter.renameWorkspace(request));
  }

  /** A chat's own rename finds the observer holding the session the same way. */
  override async renameSession(request: ProviderSessionRenameRequest): Promise<ProviderActResult> {
    return this.#dispatchAct((adapter) => adapter.renameSession(request));
  }

  override async readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult> {
    return this.#dispatchAct((adapter) => adapter.readTranscript(providerSessionId));
  }

  /**
   * Ask each capable observer in turn. Unsupported means this observer has
   * never seen the subject, so the question moves on; any firm answer is the
   * subject's own and ends the search.
   */
  async #dispatchAct<Result extends ProviderActResult>(
    act: (adapter: SessionProviderAdapter) => Promise<Result>,
  ): Promise<Result> {
    for (const adapter of this.#adapters) {
      const result = await act(adapter);
      if (result.status !== ACT_RESULT_STATUS.UNSUPPORTED) return result;
    }
    // SAFETY: every ProviderActResult specialization includes the canonical
    // unsupported branch; only accepted branches add result-specific fields.
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "No provider adapter supports that act.",
    } as Result;
  }
}
