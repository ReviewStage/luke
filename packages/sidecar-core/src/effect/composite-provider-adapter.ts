import { Effect } from "effect";
import { CompositeSessionProviderAdapter } from "../composite-provider-adapter.js";
import {
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderActResult,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  type SessionProviderAdapter,
  type WorkspaceProject,
} from "../providers.js";
import type { ProviderSessionObservation, SessionProvider } from "../session.js";
import {
  type EffectSessionProviderAdapter,
  fromPromiseAdapter,
  toPromiseAdapter,
} from "./provider-adapter.js";

export interface EffectCompositeProviderAdapterOptions {
  provider: SessionProvider;
  /** Observed in order, which is also the order that settles a repeated session. */
  adapters: readonly EffectSessionProviderAdapter[];
}

/**
 * One provider observed in more than one place — sessions on this machine and
 * the same provider's sessions in its cloud. The registry replaces a provider's
 * sessions in a single commit, so observers that share a provider id have to
 * arrive as one adapter: registered separately, each pass would retire the
 * other's sessions.
 */
export class EffectCompositeSessionProviderAdapter implements EffectSessionProviderAdapter {
  readonly provider: SessionProvider;

  readonly adapters: readonly EffectSessionProviderAdapter[];

  constructor(options: EffectCompositeProviderAdapterOptions) {
    for (const adapter of options.adapters) {
      if (adapter.provider.id !== options.provider.id) {
        throw new Error(
          `Composite adapter for ${options.provider.id} cannot observe ${adapter.provider.id}`,
        );
      }
    }
    this.provider = options.provider;
    this.adapters = options.adapters;
  }

  observe(): Effect.Effect<readonly ProviderSessionObservation[], never, never> {
    return Effect.all(
      this.adapters.map((adapter) => adapter.observe()),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((collected) => {
        const observations = new Map<string, ProviderSessionObservation>();
        for (const observation of collected.flat()) {
          if (!observations.has(observation.providerSessionId)) {
            observations.set(observation.providerSessionId, observation);
          }
        }
        return [...observations.values()];
      }),
    );
  }

  sendMessage(message: ProviderSessionMessage): Effect.Effect<ProviderMessageResult, never, never> {
    return this.#dispatchAct((adapter) => adapter.sendMessage(message));
  }

  executeControl(
    request: ProviderControlRequest,
  ): Effect.Effect<ProviderControlResult, never, never> {
    return this.#dispatchAct((adapter) => adapter.executeControl(request));
  }

  workspaceProjects(): readonly WorkspaceProject[] {
    return this.adapters.flatMap((adapter) => adapter.workspaceProjects());
  }

  createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, never> {
    return this.#dispatchAct((adapter) => adapter.createWorkspace(request));
  }

  spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, never> {
    return this.#dispatchAct((adapter) => adapter.spawnWorkspaceAgent(request));
  }

  readTranscript(providerSessionId: string): Effect.Effect<string | undefined, never, never> {
    const adapters = this.adapters;
    return Effect.gen(function* () {
      for (const adapter of adapters) {
        const transcript = yield* adapter.readTranscript(providerSessionId);
        if (transcript !== undefined) return transcript;
      }
      return undefined;
    });
  }

  #dispatchAct<Result extends ProviderActResult>(
    act: (adapter: EffectSessionProviderAdapter) => Effect.Effect<Result, never, never>,
  ): Effect.Effect<
    Result | { status: typeof PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED },
    never,
    never
  > {
    const adapters = this.adapters;
    return Effect.gen(function* () {
      for (const adapter of adapters) {
        const result = yield* act(adapter);
        if (result.status !== PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED) return result;
      }
      return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    });
  }
}

export function fromPromiseCompositeAdapter(
  composite: CompositeSessionProviderAdapter,
): EffectSessionProviderAdapter {
  return fromPromiseAdapter(composite);
}

export function toPromiseCompositeAdapter(
  effect: EffectCompositeSessionProviderAdapter,
): SessionProviderAdapter {
  return new CompositeSessionProviderAdapter({
    provider: effect.provider,
    adapters: effect.adapters.map(toPromiseAdapter),
  });
}
