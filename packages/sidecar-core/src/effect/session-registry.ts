import { Effect } from "effect";
import type { SessionProviderAdapter } from "../providers.js";
import {
  type AttentionDecision,
  type NormalizedSession,
  normalizeAttention,
  normalizeSession,
  normalizeSessionIdentity,
  type ProviderSessionObservation,
  type SessionControl,
  type SessionDetail,
  type SessionIdentity,
  type SessionProvider,
  type SessionWorkspace,
} from "../session.js";
import type { EffectSessionProviderAdapter } from "./provider-adapter.js";

export interface SessionRegistrySnapshot {
  revision: number;
  sessions: readonly NormalizedSession[];
}

export type SessionRegistryListener = (snapshot: SessionRegistrySnapshot) => void;

export type SessionObservationTransform = (
  providerId: string,
  observations: readonly ProviderSessionObservation[],
) => readonly ProviderSessionObservation[];

type ProviderSessions = Map<string, NormalizedSession>;
type SessionStore = Map<string, ProviderSessions>;

interface ProviderRefreshContext {
  readonly providerId: string;
  readonly mutationEpoch: number;
  readonly attempt: number;
}

function copySession(session: NormalizedSession): NormalizedSession {
  const detail: SessionDetail = { ...session.detail };
  if (session.detail.diff) detail.diff = { ...session.detail.diff };
  const copied: NormalizedSession = {
    ...session,
    provider: { ...session.provider },
    detail,
    controls: session.controls.map((control) => ({ ...control })),
    spawnableAgents: [...session.spawnableAgents],
    attention: { ...session.attention },
  };
  if (session.workspace) copied.workspace = { ...session.workspace };
  return copied;
}

function exhaustiveSame<T extends object>(
  equality: Record<keyof T, (first: T, second: T) => boolean>,
): (first: T, second: T) => boolean {
  // SAFETY: equality is exhaustive over T; each comparator is typed for the same T pair.
  const comparators = Object.values(equality) as Array<(first: T, second: T) => boolean>;
  return (first, second) => {
    for (const compare of comparators) {
      if (!compare(first, second)) return false;
    }
    return true;
  };
}

function sameItems<T>(
  first: readonly T[],
  second: readonly T[],
  same: (first: T, second: T) => boolean,
): boolean {
  return (
    first.length === second.length &&
    first.every((item, index) => {
      const other = second[index];
      return other !== undefined && same(item, other);
    })
  );
}

function sameOptional<T extends object>(
  first: T | undefined,
  second: T | undefined,
  same: (first: T, second: T) => boolean,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return same(first, second);
}

const sameDetail = exhaustiveSame<SessionDetail>({
  activity: (first, second) => first.activity === second.activity,
  repository: (first, second) => first.repository === second.repository,
  branch: (first, second) => first.branch === second.branch,
  model: (first, second) => first.model === second.model,
  error: (first, second) => first.error === second.error,
  link: (first, second) => first.link === second.link,
  change: (first, second) => first.change === second.change,
  diff: (first, second) =>
    sameOptional(
      first.diff,
      second.diff,
      (a, b) =>
        a.filesChanged === b.filesChanged &&
        a.linesAdded === b.linesAdded &&
        a.linesRemoved === b.linesRemoved,
    ),
});

const sameControl = exhaustiveSame<SessionControl>({
  id: (first, second) => first.id === second.id,
  label: (first, second) => first.label === second.label,
  kind: (first, second) => first.kind === second.kind,
  target: (first, second) => first.target === second.target,
});

const sameProvider = exhaustiveSame<SessionProvider>({
  id: (first, second) => first.id === second.id,
  displayName: (first, second) => first.displayName === second.displayName,
});

const sameAttention = exhaustiveSame<AttentionDecision>({
  disposition: (first, second) => first.disposition === second.disposition,
  decidedAt: (first, second) => first.decidedAt === second.decidedAt,
  summary: (first, second) => first.summary === second.summary,
  answersAsk: (first, second) => first.answersAsk === second.answersAsk,
});

const sameWorkspace = exhaustiveSame<SessionWorkspace>({
  providerWorkspaceId: (first, second) => first.providerWorkspaceId === second.providerWorkspaceId,
  scopeId: (first, second) => first.scopeId === second.scopeId,
  managerName: (first, second) => first.managerName === second.managerName,
  name: (first, second) => first.name === second.name,
});

const sameSession = exhaustiveSame<NormalizedSession>({
  providerId: (first, second) => first.providerId === second.providerId,
  providerSessionId: (first, second) => first.providerSessionId === second.providerSessionId,
  provider: (first, second) => sameProvider(first.provider, second.provider),
  title: (first, second) => first.title === second.title,
  status: (first, second) => first.status === second.status,
  completionCause: (first, second) => first.completionCause === second.completionCause,
  observedAt: (first, second) => first.observedAt === second.observedAt,
  location: (first, second) => first.location === second.location,
  recap: (first, second) => first.recap === second.recap,
  detail: (first, second) => sameDetail(first.detail, second.detail),
  controls: (first, second) => sameItems(first.controls, second.controls, sameControl),
  canReceiveMessage: (first, second) => first.canReceiveMessage === second.canReceiveMessage,
  spawnableAgents: (first, second) =>
    sameItems(first.spawnableAgents, second.spawnableAgents, Object.is),
  spawnTarget: (first, second) => first.spawnTarget === second.spawnTarget,
  workspace: (first, second) => sameOptional(first.workspace, second.workspace, sameWorkspace),
  attention: (first, second) => sameAttention(first.attention, second.attention),
});

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

export interface EffectSessionRegistry {
  readonly revision: number;
  get(identity: SessionIdentity): NormalizedSession | undefined;
  list(): readonly NormalizedSession[];
  snapshot(): SessionRegistrySnapshot;
  subscribe(listener: SessionRegistryListener): () => void;
  upsert(provider: SessionProvider, observation: ProviderSessionObservation): NormalizedSession;
  replaceProvider(
    provider: SessionProvider,
    observations: readonly ProviderSessionObservation[],
  ): SessionRegistrySnapshot;
  refreshEffect(
    adapter: Pick<EffectSessionProviderAdapter, "provider" | "observe">,
    transform?: SessionObservationTransform,
  ): Effect.Effect<SessionRegistrySnapshot, never, never>;
  setAttention(
    identity: SessionIdentity,
    attention: AttentionDecision,
  ): NormalizedSession | undefined;
  remove(identity: SessionIdentity): boolean;
}

export class InMemorySessionRegistry implements EffectSessionRegistry {
  #revision = 0;
  #sessions: SessionStore = new Map();
  #providerMutationEpochs = new Map<string, number>();
  #nextProviderRefreshAttempts = new Map<string, number>();
  #latestAppliedRefreshAttempts = new Map<string, number>();
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
    const next = copyStore(this.#sessions);
    const providerSessions = next.get(identity.providerId) ?? new Map();
    providerSessions.set(identity.providerSessionId, session);
    next.set(identity.providerId, providerSessions);
    this.#commit(next, identity.providerId);
    return copySession(session);
  }

  replaceProvider(
    provider: SessionProvider,
    observations: readonly ProviderSessionObservation[],
  ): SessionRegistrySnapshot {
    const providerId = normalizedProviderId(provider);
    this.#commit(this.#nextProviderStore(provider, providerId, observations), providerId);
    return this.snapshot();
  }

  refreshEffect(
    adapter: Pick<EffectSessionProviderAdapter, "provider" | "observe">,
    transform?: SessionObservationTransform,
  ): Effect.Effect<SessionRegistrySnapshot, never, never> {
    const self = this;
    return Effect.gen(function* () {
      const providerId = normalizedProviderId(adapter.provider);
      const context = self.#beginProviderRefresh(providerId);
      const observed = yield* adapter.observe();
      const observations = transform ? transform(providerId, observed) : observed;
      return self.#finishProviderRefresh(adapter.provider, providerId, observations, context);
    });
  }

  /** Reads a promise-based provider adapter and applies its newest full observation. */
  async refresh(
    adapter: Pick<SessionProviderAdapter, "provider" | "observe">,
    transform?: SessionObservationTransform,
  ): Promise<SessionRegistrySnapshot> {
    const context = this.beginPromiseRefresh(adapter.provider);
    const observed = await adapter.observe();
    return this.finishPromiseRefresh(adapter.provider, observed, context, transform);
  }

  /** Records refresh attempt state before a promise-side observe(). */
  beginPromiseRefresh(provider: SessionProvider): ProviderRefreshContext {
    const providerId = normalizedProviderId(provider);
    return this.#beginProviderRefresh(providerId);
  }

  /** Applies observations after a promise-side observe(), honoring stale-refresh guards. */
  finishPromiseRefresh(
    provider: SessionProvider,
    observed: readonly ProviderSessionObservation[],
    context: ProviderRefreshContext,
    transform?: SessionObservationTransform,
  ): SessionRegistrySnapshot {
    const observations = transform ? transform(context.providerId, observed) : observed;
    return this.#finishProviderRefresh(provider, context.providerId, observations, context);
  }

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
    const next = copyStore(this.#sessions);
    const providerSessions = next.get(normalizedIdentity.providerId);
    if (!providerSessions) throw new Error("Session provider disappeared during removal");
    providerSessions.delete(normalizedIdentity.providerSessionId);
    if (providerSessions.size === 0) next.delete(normalizedIdentity.providerId);
    this.#commit(next, normalizedIdentity.providerId);
    return true;
  }

  #nextProviderStore(
    provider: SessionProvider,
    providerId: string,
    observations: readonly ProviderSessionObservation[],
  ): SessionStore {
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
    return next;
  }

  #startProviderRefreshAttempt(providerId: string): number {
    const nextAttempt = (this.#nextProviderRefreshAttempts.get(providerId) ?? 0) + 1;
    this.#nextProviderRefreshAttempts.set(providerId, nextAttempt);
    return nextAttempt;
  }

  #beginProviderRefresh(providerId: string): ProviderRefreshContext {
    return {
      providerId,
      mutationEpoch: this.#providerMutationEpochs.get(providerId) ?? 0,
      attempt: this.#startProviderRefreshAttempt(providerId),
    };
  }

  #finishProviderRefresh(
    provider: SessionProvider,
    providerId: string,
    observations: readonly ProviderSessionObservation[],
    context: ProviderRefreshContext,
  ): SessionRegistrySnapshot {
    const latestAttempt = this.#latestAppliedRefreshAttempts.get(providerId) ?? 0;
    if (
      latestAttempt >= context.attempt ||
      (this.#providerMutationEpochs.get(providerId) ?? 0) !== context.mutationEpoch
    ) {
      return this.snapshot();
    }
    const next = this.#nextProviderStore(provider, providerId, observations);
    this.#latestAppliedRefreshAttempts.set(providerId, context.attempt);
    this.#commit(next);
    return this.snapshot();
  }

  #commit(next: SessionStore, invalidateRefreshesForProvider?: string): boolean {
    if (sameSessions(this.#sessions, next)) return false;
    if (invalidateRefreshesForProvider) {
      const nextEpoch = (this.#providerMutationEpochs.get(invalidateRefreshesForProvider) ?? 0) + 1;
      this.#providerMutationEpochs.set(invalidateRefreshesForProvider, nextEpoch);
    }
    this.#sessions = next;
    this.#revision += 1;
    for (const listener of this.#listeners) listener(this.snapshot());
    return true;
  }
}
