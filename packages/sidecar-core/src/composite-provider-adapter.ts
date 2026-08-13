import type { SessionProviderAdapter } from "./providers";
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
export class CompositeSessionProviderAdapter implements SessionProviderAdapter {
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
}
