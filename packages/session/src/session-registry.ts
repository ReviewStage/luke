import type { SessionProviderAdapter } from "./providers.js";
import {
  type AttentionDecision,
  normalizeAttention,
  normalizeSession,
  normalizeSessionIdentity,
  type ProviderSessionObservation,
  type Session,
  type SessionApplication,
  type SessionControl,
  type SessionDetail,
  type SessionIdentity,
  type SessionProvider,
  type SessionWorkspace,
} from "./session.js";

export interface SessionRegistrySnapshot {
  revision: number;
  sessions: readonly Session[];
  attention: readonly SessionAttentionEntry[];
}

/** One evaluator decision, kept beside rather than inside provider-owned session state. */
export interface SessionAttentionEntry extends SessionIdentity {
  decision: AttentionDecision;
}

export type SessionRegistryListener = (snapshot: SessionRegistrySnapshot) => void;

type SessionObservationTransform = (
  providerId: string,
  observations: readonly ProviderSessionObservation[],
) => readonly ProviderSessionObservation[];

type ProviderSessions = Map<string, Session>;
type SessionStore = Map<string, ProviderSessions>;

function copySession(session: Session): Session {
  const detail: SessionDetail = { ...session.detail };
  if (session.detail.diff) detail.diff = { ...session.detail.diff };
  const copied: Session = {
    ...session,
    provider: { ...session.provider },
    detail,
    applications: session.applications.map((application) => ({ ...application })),
    controls: session.controls.map((control) => ({ ...control })),
    spawnableAgents: [...session.spawnableAgents],
  };
  if (session.workspace) copied.workspace = { ...session.workspace };
  if (session.agent) copied.agent = { ...session.agent };
  return copied;
}

/**
 * An equality function from a comparator per field. The `Record` is exhaustive
 * over `T` on purpose: a new field does not compile until someone decides how
 * it compares.
 *
 * Comparators are collected once at module load, then walked with an `&&`
 * chain's short-circuit, so `#commit` does one field compare per key rather
 * than serializing the session on every observation.
 */
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

/**
 * Compares the observed context field by field. A detail that changed without
 * the status changing is exactly the case the registry exists to notice — a
 * session that moved from one file to the next is still working, and the row
 * has to follow it.
 */
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

const sameApplication = exhaustiveSame<SessionApplication>({
  id: (first, second) => first.id === second.id,
  displayName: (first, second) => first.displayName === second.displayName,
  scope: (first, second) => first.scope === second.scope,
  link: (first, second) => first.link === second.link,
});

const sameAttention = exhaustiveSame<AttentionDecision>({
  disposition: (first, second) => first.disposition === second.disposition,
  decidedAt: (first, second) => first.decidedAt === second.decidedAt,
  summary: (first, second) => first.summary === second.summary,
});

const sameWorkspace = exhaustiveSame<SessionWorkspace>({
  providerWorkspaceId: (first, second) => first.providerWorkspaceId === second.providerWorkspaceId,
  scopeId: (first, second) => first.scopeId === second.scopeId,
  managerName: (first, second) => first.managerName === second.managerName,
  name: (first, second) => first.name === second.name,
});

const sameSession = exhaustiveSame<Session>({
  providerId: (first, second) => first.providerId === second.providerId,
  providerSessionId: (first, second) => first.providerSessionId === second.providerSessionId,
  provider: (first, second) => sameProvider(first.provider, second.provider),
  parentProviderSessionId: (first, second) =>
    first.parentProviderSessionId === second.parentProviderSessionId,
  title: (first, second) => first.title === second.title,
  status: (first, second) => first.status === second.status,
  completionCause: (first, second) => first.completionCause === second.completionCause,
  observedAt: (first, second) => first.observedAt === second.observedAt,
  realtimeVoice: (first, second) => first.realtimeVoice === second.realtimeVoice,
  realtimeVoiceLive: (first, second) => first.realtimeVoiceLive === second.realtimeVoiceLive,
  standing: (first, second) => first.standing === second.standing,
  location: (first, second) => first.location === second.location,
  agent: (first, second) => sameOptional(first.agent, second.agent, sameProvider),
  recap: (first, second) => first.recap === second.recap,
  detail: (first, second) => sameDetail(first.detail, second.detail),
  applications: (first, second) =>
    sameItems(first.applications, second.applications, sameApplication),
  controls: (first, second) => sameItems(first.controls, second.controls, sameControl),
  canReceiveMessage: (first, second) => first.canReceiveMessage === second.canReceiveMessage,
  holdingForDeveloper: (first, second) => first.holdingForDeveloper === second.holdingForDeveloper,
  canRename: (first, second) => first.canRename === second.canRename,
  spawnableAgents: (first, second) =>
    sameItems(first.spawnableAgents, second.spawnableAgents, Object.is),
  spawnTarget: (first, second) => first.spawnTarget === second.spawnTarget,
  renameTarget: (first, second) => first.renameTarget === second.renameTarget,
  workspace: (first, second) => sameOptional(first.workspace, second.workspace, sameWorkspace),
});

function sameProviderSessions(
  first: ReadonlyMap<string, Session>,
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
  #attention = new Map<string, Map<string, AttentionDecision>>();
  #providerMutationEpochs = new Map<string, number>();
  #nextProviderRefreshAttempts = new Map<string, number>();
  #latestAppliedRefreshAttempts = new Map<string, number>();
  #listeners = new Set<SessionRegistryListener>();

  get revision(): number {
    return this.#revision;
  }

  get(identity: SessionIdentity): Session | undefined {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const session = this.#sessions
      .get(normalizedIdentity.providerId)
      ?.get(normalizedIdentity.providerSessionId);
    return session && copySession(session);
  }

  list(): readonly Session[] {
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
      attention: [...this.#attention].flatMap(([providerId, decisions]) =>
        [...decisions].map(
          ([providerSessionId, decision]): SessionAttentionEntry => ({
            providerId,
            providerSessionId,
            decision: { ...decision },
          }),
        ),
      ),
    };
  }

  subscribe(listener: SessionRegistryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  upsert(provider: SessionProvider, observation: ProviderSessionObservation): Session {
    const identity = normalizeSessionIdentity({
      providerId: provider.id,
      providerSessionId: observation.providerSessionId,
    });
    const session = normalizeSession(provider, observation);
    const next = copyStore(this.#sessions);
    const providerSessions = next.get(identity.providerId) ?? new Map();
    providerSessions.set(identity.providerSessionId, session);
    next.set(identity.providerId, providerSessions);
    this.#commit(next, identity.providerId);
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
    this.#commit(this.#nextProviderStore(provider, providerId, observations), providerId);
    return this.snapshot();
  }

  /** Reads a provider adapter and applies its newest full observation as one update. */
  async refresh(
    adapter: Pick<SessionProviderAdapter, "provider" | "observe">,
    transform?: SessionObservationTransform,
  ): Promise<SessionRegistrySnapshot> {
    const providerId = normalizedProviderId(adapter.provider);
    const mutationEpoch = this.#providerMutationEpochs.get(providerId) ?? 0;
    const attempt = this.#startProviderRefreshAttempt(providerId);
    const observed = await adapter.observe();
    const observations = transform ? transform(providerId, observed) : observed;
    const latestAttempt = this.#latestAppliedRefreshAttempts.get(providerId) ?? 0;
    if (
      latestAttempt >= attempt ||
      (this.#providerMutationEpochs.get(providerId) ?? 0) !== mutationEpoch
    ) {
      return this.snapshot();
    }
    const next = this.#nextProviderStore(adapter.provider, providerId, observations);
    this.#latestAppliedRefreshAttempts.set(providerId, attempt);
    this.#commit(next);
    return this.snapshot();
  }

  /** Stores Luke's latest attention decision without mutating provider-owned data. */
  setAttention(identity: SessionIdentity, attention: AttentionDecision): Session | undefined {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const existing = this.#sessions
      .get(normalizedIdentity.providerId)
      ?.get(normalizedIdentity.providerSessionId);
    if (!existing) return undefined;

    const normalized = normalizeAttention(attention);
    const decisions = this.#attention.get(normalizedIdentity.providerId) ?? new Map();
    const previous = decisions.get(normalizedIdentity.providerSessionId);
    if (previous && sameAttention(previous, normalized)) return copySession(existing);
    decisions.set(normalizedIdentity.providerSessionId, normalized);
    this.#attention.set(normalizedIdentity.providerId, decisions);
    this.#revision += 1;
    this.#notify();
    return copySession(existing);
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

  #commit(next: SessionStore, invalidateRefreshesForProvider?: string): boolean {
    if (sameSessions(this.#sessions, next)) return false;
    if (invalidateRefreshesForProvider) {
      const nextEpoch = (this.#providerMutationEpochs.get(invalidateRefreshesForProvider) ?? 0) + 1;
      this.#providerMutationEpochs.set(invalidateRefreshesForProvider, nextEpoch);
    }
    this.#sessions = next;
    this.#pruneAttention(next);
    this.#revision += 1;
    this.#notify();
    return true;
  }

  #pruneAttention(sessions: SessionStore): void {
    for (const [providerId, decisions] of this.#attention) {
      const providerSessions = sessions.get(providerId);
      if (!providerSessions) {
        this.#attention.delete(providerId);
        continue;
      }
      for (const providerSessionId of decisions.keys()) {
        if (!providerSessions.has(providerSessionId)) decisions.delete(providerSessionId);
      }
      if (decisions.size === 0) this.#attention.delete(providerId);
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.snapshot());
  }
}
