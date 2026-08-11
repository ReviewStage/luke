import type { SessionProviderAdapter } from "./providers";
import {
  type AttentionDecision,
  type NormalizedSession,
  normalizeAttention,
  normalizeSession,
  normalizeSessionIdentity,
  type ProviderSessionObservation,
  type SessionIdentity,
  type SessionProvider,
} from "./session";

export interface SessionRegistrySnapshot {
  revision: number;
  sessions: readonly NormalizedSession[];
}

export type SessionRegistryListener = (snapshot: SessionRegistrySnapshot) => void;

type ProviderSessions = Map<string, NormalizedSession>;
type SessionStore = Map<string, ProviderSessions>;

function copySession(session: NormalizedSession): NormalizedSession {
  return {
    ...session,
    provider: { ...session.provider },
    controls: session.controls.map((control) => ({ ...control })),
    attention: { ...session.attention },
  };
}

function sameControls(
  first: readonly NormalizedSession["controls"][number][],
  second: readonly NormalizedSession["controls"][number][],
): boolean {
  return (
    first.length === second.length &&
    first.every(
      (control, index) =>
        control.id === second[index]?.id && control.label === second[index]?.label,
    )
  );
}

function sameSession(first: NormalizedSession, second: NormalizedSession): boolean {
  return (
    first.providerId === second.providerId &&
    first.providerSessionId === second.providerSessionId &&
    first.provider.id === second.provider.id &&
    first.provider.displayName === second.provider.displayName &&
    first.title === second.title &&
    first.status === second.status &&
    first.observedAt === second.observedAt &&
    first.summary === second.summary &&
    first.attention.disposition === second.attention.disposition &&
    first.attention.decidedAt === second.attention.decidedAt &&
    first.attention.summary === second.attention.summary &&
    sameControls(first.controls, second.controls)
  );
}

function sameProviderSessions(
  first: ReadonlyMap<string, NormalizedSession>,
  second: ProviderSessions,
): boolean {
  return (
    first.size === second.size &&
    [...first].every(([providerSessionId, session]) => {
      const candidate = second.get(providerSessionId);
      return candidate !== undefined && sameSession(session, candidate);
    })
  );
}

function sameSessions(first: ReadonlyMap<string, ProviderSessions>, second: SessionStore): boolean {
  return (
    first.size === second.size &&
    [...first].every(([providerId, sessions]) => {
      const candidate = second.get(providerId);
      return candidate !== undefined && sameProviderSessions(sessions, candidate);
    })
  );
}

function copyStore(store: ReadonlyMap<string, ProviderSessions>): SessionStore {
  return new Map([...store].map(([providerId, sessions]) => [providerId, new Map(sessions)]));
}

function normalizedProviderId(provider: SessionProvider): string {
  const providerId = provider.id.trim();
  if (!providerId) throw new Error("provider id must not be empty");
  return providerId;
}

/**
 * A portable, in-memory source of truth for normalized sessions. It never
 * persists observations, and only replaces records after a provider snapshot
 * has been validated in full.
 */
export class InMemorySessionRegistry {
  #revision = 0;
  #sessions: SessionStore = new Map();
  #providerRefreshGenerations = new Map<string, number>();
  #listeners = new Set<SessionRegistryListener>();

  get revision(): number {
    return this.#revision;
  }

  get(identity: SessionIdentity): NormalizedSession | undefined {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const session = this.#sessions
      .get(normalizedIdentity.providerId)
      ?.get(normalizedIdentity.providerSessionId);
    return session && copySession(session);
  }

  list(): readonly NormalizedSession[] {
    return [...this.#sessions.values()]
      .flatMap((sessions) => [...sessions.values()])
      .sort(
        (first, second) =>
          second.observedAt - first.observedAt ||
          first.providerId.localeCompare(second.providerId) ||
          first.providerSessionId.localeCompare(second.providerSessionId),
      )
      .map(copySession);
  }

  snapshot(): SessionRegistrySnapshot {
    return {
      revision: this.#revision,
      sessions: this.list(),
    };
  }

  subscribe(listener: SessionRegistryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  upsert(provider: SessionProvider, observation: ProviderSessionObservation): NormalizedSession {
    const identity = normalizeSessionIdentity({
      providerId: provider.id,
      providerSessionId: observation.providerSessionId,
    });
    const existing = this.#sessions.get(identity.providerId)?.get(identity.providerSessionId);
    const session = normalizeSession(provider, observation, existing?.attention);
    this.#advanceProviderRefreshGeneration(identity.providerId);
    const next = copyStore(this.#sessions);
    const providerSessions = next.get(identity.providerId) ?? new Map();
    providerSessions.set(identity.providerSessionId, session);
    next.set(identity.providerId, providerSessions);
    this.#commit(next);
    return copySession(session);
  }

  /**
   * Replaces one provider's observed sessions atomically. Sessions from other
   * providers, along with their attention decisions, remain untouched.
   */
  replaceProvider(
    provider: SessionProvider,
    observations: readonly ProviderSessionObservation[],
  ): SessionRegistrySnapshot {
    const providerId = normalizedProviderId(provider);
    this.#advanceProviderRefreshGeneration(providerId);
    return this.#replaceProvider(provider, providerId, observations);
  }

  /** Reads a provider adapter and applies its newest full observation as one update. */
  async refresh(adapter: SessionProviderAdapter): Promise<SessionRegistrySnapshot> {
    const providerId = normalizedProviderId(adapter.provider);
    const generation = this.#advanceProviderRefreshGeneration(providerId);
    const observations = await adapter.observe();
    if (this.#providerRefreshGenerations.get(providerId) !== generation) return this.snapshot();
    return this.#replaceProvider(adapter.provider, providerId, observations);
  }

  /** Stores Luke's latest attention decision without mutating provider-owned data. */
  setAttention(
    identity: SessionIdentity,
    attention: AttentionDecision,
  ): NormalizedSession | undefined {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const existing = this.#sessions
      .get(normalizedIdentity.providerId)
      ?.get(normalizedIdentity.providerSessionId);
    if (!existing) return undefined;

    const nextSession: NormalizedSession = {
      ...existing,
      attention: normalizeAttention(attention),
    };
    const next = copyStore(this.#sessions);
    const providerSessions = next.get(normalizedIdentity.providerId);
    if (!providerSessions) throw new Error("Session provider disappeared during attention update");
    providerSessions.set(normalizedIdentity.providerSessionId, nextSession);
    this.#commit(next);
    return copySession(nextSession);
  }

  remove(identity: SessionIdentity): boolean {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const existingProviderSessions = this.#sessions.get(normalizedIdentity.providerId);
    if (!existingProviderSessions?.has(normalizedIdentity.providerSessionId)) return false;
    this.#advanceProviderRefreshGeneration(normalizedIdentity.providerId);
    const next = copyStore(this.#sessions);
    const providerSessions = next.get(normalizedIdentity.providerId);
    if (!providerSessions) throw new Error("Session provider disappeared during removal");
    providerSessions.delete(normalizedIdentity.providerSessionId);
    if (providerSessions.size === 0) next.delete(normalizedIdentity.providerId);
    this.#commit(next);
    return true;
  }

  #replaceProvider(
    provider: SessionProvider,
    providerId: string,
    observations: readonly ProviderSessionObservation[],
  ): SessionRegistrySnapshot {
    const existingForProvider = this.#sessions.get(providerId);
    const replacement: ProviderSessions = new Map();

    for (const observation of observations) {
      const { providerSessionId } = normalizeSessionIdentity({
        providerId,
        providerSessionId: observation.providerSessionId,
      });
      if (replacement.has(providerSessionId)) {
        throw new Error(`Duplicate session observation: ${observation.providerSessionId}`);
      }
      replacement.set(
        providerSessionId,
        normalizeSession(
          provider,
          observation,
          existingForProvider?.get(providerSessionId)?.attention,
        ),
      );
    }

    const next = copyStore(this.#sessions);
    if (replacement.size === 0) next.delete(providerId);
    else next.set(providerId, replacement);
    this.#commit(next);
    return this.snapshot();
  }

  #advanceProviderRefreshGeneration(providerId: string): number {
    const nextGeneration = (this.#providerRefreshGenerations.get(providerId) ?? 0) + 1;
    this.#providerRefreshGenerations.set(providerId, nextGeneration);
    return nextGeneration;
  }

  #commit(next: SessionStore): void {
    if (sameSessions(this.#sessions, next)) return;
    this.#sessions = next;
    this.#revision += 1;
    for (const listener of this.#listeners) listener(this.snapshot());
  }
}
