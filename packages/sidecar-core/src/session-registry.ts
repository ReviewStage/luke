import type { SessionProviderAdapter } from "./providers";
import {
  type AttentionDecision,
  type NormalizedSession,
  normalizeAttention,
  normalizeSession,
  type ProviderSessionObservation,
  type SessionIdentity,
  type SessionProvider,
  sessionKey,
} from "./session";

export interface SessionRegistrySnapshot {
  revision: number;
  sessions: readonly NormalizedSession[];
}

export type SessionRegistryListener = (snapshot: SessionRegistrySnapshot) => void;

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
    first.id === second.id &&
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

function sameSessions(
  first: ReadonlyMap<string, NormalizedSession>,
  second: ReadonlyMap<string, NormalizedSession>,
): boolean {
  return (
    first.size === second.size &&
    [...first].every(([id, session]) => {
      const candidate = second.get(id);
      return candidate !== undefined && sameSession(session, candidate);
    })
  );
}

/**
 * A portable, in-memory source of truth for normalized sessions. It never
 * persists observations, and only replaces records after a provider snapshot
 * has been validated in full.
 */
export class InMemorySessionRegistry {
  #revision = 0;
  #sessions = new Map<string, NormalizedSession>();
  #listeners = new Set<SessionRegistryListener>();

  get revision(): number {
    return this.#revision;
  }

  get(identity: SessionIdentity): NormalizedSession | undefined {
    const session = this.#sessions.get(sessionKey(identity));
    return session && copySession(session);
  }

  list(): readonly NormalizedSession[] {
    return [...this.#sessions.values()]
      .sort(
        (first, second) =>
          second.observedAt - first.observedAt || first.id.localeCompare(second.id),
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
    const identity = {
      providerId: provider.id,
      providerSessionId: observation.providerSessionId,
    };
    const key = sessionKey(identity);
    const existing = this.#sessions.get(key);
    const session = normalizeSession(provider, observation, existing?.attention);
    const next = new Map(this.#sessions);
    next.set(key, session);
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
    const providerId = provider.id.trim();
    if (!providerId) throw new Error("provider id must not be empty");
    const existingForProvider = new Map(
      [...this.#sessions]
        .filter(([, session]) => session.providerId === providerId)
        .map(([id, session]) => [id, session]),
    );
    const replacement = new Map<string, NormalizedSession>();

    for (const observation of observations) {
      const key = sessionKey({ providerId, providerSessionId: observation.providerSessionId });
      if (replacement.has(key)) {
        throw new Error(`Duplicate session observation: ${observation.providerSessionId}`);
      }
      replacement.set(
        key,
        normalizeSession(provider, observation, existingForProvider.get(key)?.attention),
      );
    }

    const next = new Map(
      [...this.#sessions].filter(([, session]) => session.providerId !== providerId),
    );
    for (const [id, session] of replacement) next.set(id, session);
    this.#commit(next);
    return this.snapshot();
  }

  /** Reads a provider adapter and applies its full observation as one update. */
  async refresh(adapter: SessionProviderAdapter): Promise<SessionRegistrySnapshot> {
    const observations = await adapter.observe();
    return this.replaceProvider(adapter.provider, observations);
  }

  /** Stores Luke's latest attention decision without mutating provider-owned data. */
  setAttention(
    identity: SessionIdentity,
    attention: AttentionDecision,
  ): NormalizedSession | undefined {
    const key = sessionKey(identity);
    const existing = this.#sessions.get(key);
    if (!existing) return undefined;

    const nextSession: NormalizedSession = {
      ...existing,
      attention: normalizeAttention(attention),
    };
    const next = new Map(this.#sessions);
    next.set(key, nextSession);
    this.#commit(next);
    return copySession(nextSession);
  }

  remove(identity: SessionIdentity): boolean {
    const key = sessionKey(identity);
    if (!this.#sessions.has(key)) return false;
    const next = new Map(this.#sessions);
    next.delete(key);
    this.#commit(next);
    return true;
  }

  #commit(next: Map<string, NormalizedSession>): void {
    if (sameSessions(this.#sessions, next)) return;
    this.#sessions = next;
    this.#revision += 1;
    for (const listener of this.#listeners) listener(this.snapshot());
  }
}
