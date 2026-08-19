import { Effect } from "effect";
import { runPromiseOrDie } from "./effect/runtime-bridge.js";
import { EffectInMemorySessionRegistry } from "./effect/session-registry.js";
import type { SessionProviderAdapter } from "./providers.js";
import type {
  AttentionDecision,
  NormalizedSession,
  ProviderSessionObservation,
  SessionIdentity,
  SessionProvider,
} from "./session.js";

export interface SessionRegistrySnapshot {
  revision: number;
  sessions: readonly NormalizedSession[];
}

export type SessionRegistryListener = (snapshot: SessionRegistrySnapshot) => void;

type SessionObservationTransform = (
  providerId: string,
  observations: readonly ProviderSessionObservation[],
) => readonly ProviderSessionObservation[];

/**
 * A portable, in-memory source of truth for normalized sessions. It never
 * persists observations, and only replaces records after a provider snapshot
 * has been validated in full.
 */
export class InMemorySessionRegistry {
  readonly #registry = new EffectInMemorySessionRegistry();

  get revision(): number {
    return this.#registry.revision;
  }

  get(identity: SessionIdentity): NormalizedSession | undefined {
    return this.#registry.get(identity);
  }

  list(): readonly NormalizedSession[] {
    return this.#registry.list();
  }

  snapshot(): SessionRegistrySnapshot {
    return this.#registry.snapshot();
  }

  subscribe(listener: SessionRegistryListener): () => void {
    return this.#registry.subscribe(listener);
  }

  upsert(provider: SessionProvider, observation: ProviderSessionObservation): NormalizedSession {
    return this.#registry.upsert(provider, observation);
  }

  /**
   * Replaces one provider's observed sessions atomically. Sessions from other
   * providers, along with their attention decisions, remain untouched.
   */
  replaceProvider(
    provider: SessionProvider,
    observations: readonly ProviderSessionObservation[],
  ): SessionRegistrySnapshot {
    return this.#registry.replaceProvider(provider, observations);
  }

  /** Reads a provider adapter and applies its newest full observation as one update. */
  async refresh(
    adapter: Pick<SessionProviderAdapter, "provider" | "observe">,
    transform?: SessionObservationTransform,
  ): Promise<SessionRegistrySnapshot> {
    return runPromiseOrDie(
      this.#registry.refresh(
        {
          provider: adapter.provider,
          observe: () =>
            Effect.async<readonly ProviderSessionObservation[], never>((resume) => {
              void adapter.observe().then(
                (observations) => resume(Effect.succeed(observations)),
                (error) => resume(Effect.die(error)),
              );
            }),
        },
        transform,
      ),
    );
  }

  /** Stores Luke's latest attention decision without mutating provider-owned data. */
  setAttention(
    identity: SessionIdentity,
    attention: AttentionDecision,
  ): NormalizedSession | undefined {
    return this.#registry.setAttention(identity, attention);
  }

  remove(identity: SessionIdentity): boolean {
    return this.#registry.remove(identity);
  }
}
