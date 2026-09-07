import type { SessionProviderAdapter } from "./providers.js";
import {
  normalizeSession,
  normalizeSessionIdentity,
  type ProviderSessionObservation,
  type Session,
  type SessionIdentity,
  type SessionProvider,
} from "./session.js";

export type SessionRosterListener = (sessions: readonly Session[]) => void;

type SessionObservationTransform = (
  providerId: string,
  observations: readonly ProviderSessionObservation[],
) => readonly ProviderSessionObservation[];

type ProviderSessions = Map<string, Session>;

function normalizedProviderId(provider: SessionProvider): string {
  const providerId = provider.id.trim();
  if (!providerId) throw new Error("provider id must not be empty");
  return providerId;
}

/**
 * The roster is the latest poll and nothing more: each provider's most recent
 * observation, normalized, merged into one list for the panel, the brain, and
 * act validation. Nothing here detects a change — no field comparators, no
 * revision, no retention of sessions a provider stopped reporting. A session
 * leaves the roster on the pass that no longer reports it, every pass is
 * announced to the listeners whether or not anything moved, and the brain
 * notices what is new against its own memory.
 */
export class SessionRoster {
  #sessions = new Map<string, ProviderSessions>();
  #listeners = new Set<SessionRosterListener>();

  get(identity: SessionIdentity): Session | undefined {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    return this.#sessions
      .get(normalizedIdentity.providerId)
      ?.get(normalizedIdentity.providerSessionId);
  }

  /** Every provider's latest sessions, newest activity first. */
  list(): readonly Session[] {
    return [...this.#sessions.values()]
      .flatMap((sessions) => [...sessions.values()])
      .sort(
        (first, second) =>
          second.lastActivityAt - first.lastActivityAt ||
          first.providerId.localeCompare(second.providerId) ||
          first.providerSessionId.localeCompare(second.providerSessionId),
      );
  }

  subscribe(listener: SessionRosterListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Replaces one provider's sessions with its latest observation, whole. An
   * observation that does not normalize leaves the provider's previous
   * sessions standing rather than half of a new list.
   */
  replaceProvider(
    provider: SessionProvider,
    observations: readonly ProviderSessionObservation[],
  ): readonly Session[] {
    const providerId = normalizedProviderId(provider);
    const replacement: ProviderSessions = new Map();
    for (const observation of observations) {
      const { providerSessionId } = normalizeSessionIdentity({
        providerId,
        providerSessionId: observation.providerSessionId,
      });
      if (replacement.has(providerSessionId)) {
        throw new Error(`Duplicate session observation: ${observation.providerSessionId}`);
      }
      replacement.set(providerSessionId, normalizeSession(provider, observation));
    }
    if (replacement.size === 0) this.#sessions.delete(providerId);
    else this.#sessions.set(providerId, replacement);
    const sessions = this.list();
    for (const listener of this.#listeners) listener(sessions);
    return sessions;
  }

  /** Reads a provider adapter and takes its newest full observation as the provider's sessions. */
  async refresh(
    adapter: Pick<SessionProviderAdapter, "provider" | "observe">,
    transform?: SessionObservationTransform,
  ): Promise<readonly Session[]> {
    const providerId = normalizedProviderId(adapter.provider);
    const observed = await adapter.observe();
    return this.replaceProvider(
      adapter.provider,
      transform ? transform(providerId, observed) : observed,
    );
  }
}
