import {
  ATTENTION_DISPOSITION,
  type AttentionDecision,
  type AttentionDisposition,
  type NormalizedSession,
  normalizeAttention,
  normalizeSessionIdentity,
  type SessionIdentity,
  type SessionStatus,
  silentAttention,
} from "./session";

export const ATTENTION_TRIGGER = {
  OBSERVED: "observed",
  STATUS_CHANGED: "status-changed",
  SUMMARY_CHANGED: "summary-changed",
} as const;

export type AttentionTrigger = (typeof ATTENTION_TRIGGER)[keyof typeof ATTENTION_TRIGGER];

/** A spoken sentence stays far shorter than the summary a provider may observe. */
export const maximumAttentionSummaryLength = 180;

export const ATTENTION_DECISION_SCHEMA_NAME = "attention_decision";

const ATTENTION_DISPOSITIONS: readonly AttentionDisposition[] =
  Object.values(ATTENTION_DISPOSITION);

const ATTENTION_REVIEW_DEFAULTS = {
  REPEAT_WINDOW_MS: 10 * 60 * 1000,
  MAXIMUM_UPDATES_PER_REVIEW: 4,
} as const;

/**
 * The decision contract an evaluator must satisfy. It is deliberately small so
 * a background model returns a disposition and, at most, one spoken sentence.
 */
export const ATTENTION_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["disposition", "summary"],
  properties: {
    disposition: {
      type: "string",
      enum: ATTENTION_DISPOSITIONS,
      description:
        "silent when the update is not worth saying out loud, speak-during-turn when the developer is blocking the session right now, speak-at-turn-end when the session reached a resting point.",
    },
    summary: {
      type: ["string", "null"],
      description: `One short spoken sentence under ${maximumAttentionSummaryLength} characters, or null when the disposition is silent.`,
    },
  },
};

/**
 * A bounded, redacted description of what changed for one session. It is the
 * only session material an attention evaluator ever receives, and it carries no
 * provider transcript, file path, or command output.
 */
export interface AttentionUpdate extends SessionIdentity {
  trigger: AttentionTrigger;
  providerName: string;
  title: string;
  status: SessionStatus;
  previousStatus?: SessionStatus;
  summary?: string;
  observedAt: number;
}

/** Reviews one bounded update and decides whether Luke should speak. */
export interface AttentionEvaluator {
  evaluate(update: AttentionUpdate): Promise<AttentionDecision | undefined>;
}

/** The decision a reviewer reached for one session, after deduplication. */
export interface AttentionReview extends SessionIdentity {
  update: AttentionUpdate;
  decision: AttentionDecision;
  suppressed: boolean;
}

export interface AttentionSpeechLedgerOptions {
  now?: () => number;
  repeatWindowMs?: number;
}

export interface SessionAttentionReviewerOptions {
  evaluator: AttentionEvaluator;
  now?: () => number;
  repeatWindowMs?: number;
  maximumUpdatesPerReview?: number;
}

interface SpokenRecord {
  disposition: AttentionDisposition;
  summary?: string;
  spokenAt: number;
}

interface AttentionCandidate {
  session: NormalizedSession;
  update: AttentionUpdate;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function isAttentionDisposition(value: unknown): value is AttentionDisposition {
  return (
    typeof value === "string" && ATTENTION_DISPOSITIONS.some((disposition) => disposition === value)
  );
}

function attentionTrigger(
  session: NormalizedSession,
  previous: NormalizedSession | undefined,
): AttentionTrigger | undefined {
  if (!previous) return ATTENTION_TRIGGER.OBSERVED;
  if (previous.status !== session.status) return ATTENTION_TRIGGER.STATUS_CHANGED;
  if (previous.summary !== session.summary) return ATTENTION_TRIGGER.SUMMARY_CHANGED;
  return undefined;
}

/**
 * Derives the bounded update worth reviewing, or nothing when a newly observed
 * session says the same thing it said last time. A repeated observation is not
 * a development, so it never reaches an evaluator.
 */
export function attentionUpdate(
  session: NormalizedSession,
  previous?: NormalizedSession,
): AttentionUpdate | undefined {
  const trigger = attentionTrigger(session, previous);
  if (!trigger) return undefined;

  return {
    providerId: session.providerId,
    providerSessionId: session.providerSessionId,
    trigger,
    providerName: session.provider.displayName,
    title: session.title,
    status: session.status,
    ...(previous ? { previousStatus: previous.status } : {}),
    ...(session.summary ? { summary: session.summary } : {}),
    observedAt: session.observedAt,
  };
}

/**
 * Validates untrusted model output against the decision contract. Anything that
 * does not satisfy the contract is discarded rather than repaired, so a
 * malformed response leaves Luke silent.
 */
export function attentionDecisionFromModel(
  value: unknown,
  decidedAt: number,
): AttentionDecision | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (!isAttentionDisposition(record.disposition)) return undefined;

  const summary =
    typeof record.summary === "string"
      ? record.summary.trim().slice(0, maximumAttentionSummaryLength)
      : undefined;
  if (record.disposition !== ATTENTION_DISPOSITION.SILENT && !summary) return undefined;

  return normalizeAttention({
    disposition: record.disposition,
    decidedAt,
    ...(summary ? { summary } : {}),
  });
}

/**
 * Remembers what Luke already said about each session so the same development
 * is not announced twice. Records are keyed by provider identity rather than by
 * a composed string, and sessions that disappear are forgotten.
 */
export class AttentionSpeechLedger {
  readonly #now: () => number;
  readonly #repeatWindowMs: number;
  #spoken = new Map<string, Map<string, SpokenRecord>>();

  constructor(options: AttentionSpeechLedgerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#repeatWindowMs = nonNegativeNumber(
      options.repeatWindowMs,
      ATTENTION_REVIEW_DEFAULTS.REPEAT_WINDOW_MS,
    );
  }

  /** Reports whether a decision says something new enough to be worth speaking. */
  shouldSpeak(identity: SessionIdentity, decision: AttentionDecision): boolean {
    if (decision.disposition === ATTENTION_DISPOSITION.SILENT) return false;

    const normalizedIdentity = normalizeSessionIdentity(identity);
    const record = this.#spoken
      .get(normalizedIdentity.providerId)
      ?.get(normalizedIdentity.providerSessionId);
    if (!record) return true;
    if (record.disposition !== decision.disposition) return true;
    if (record.summary !== decision.summary) return true;
    return this.#now() - record.spokenAt >= this.#repeatWindowMs;
  }

  remember(identity: SessionIdentity, decision: AttentionDecision): void {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const providerRecords =
      this.#spoken.get(normalizedIdentity.providerId) ?? new Map<string, SpokenRecord>();
    providerRecords.set(normalizedIdentity.providerSessionId, {
      disposition: decision.disposition,
      ...(decision.summary ? { summary: decision.summary } : {}),
      spokenAt: this.#now(),
    });
    this.#spoken.set(normalizedIdentity.providerId, providerRecords);
  }

  /** Drops records for sessions a provider no longer reports. */
  retain(identities: readonly SessionIdentity[]): void {
    const live = new Map<string, Set<string>>();
    for (const identity of identities) {
      const normalizedIdentity = normalizeSessionIdentity(identity);
      const providerSessionIds = live.get(normalizedIdentity.providerId) ?? new Set<string>();
      providerSessionIds.add(normalizedIdentity.providerSessionId);
      live.set(normalizedIdentity.providerId, providerSessionIds);
    }

    const retained = new Map<string, Map<string, SpokenRecord>>();
    for (const [providerId, providerRecords] of this.#spoken) {
      const providerSessionIds = live.get(providerId);
      if (!providerSessionIds) continue;
      const kept = new Map(
        [...providerRecords].filter(([providerSessionId]) =>
          providerSessionIds.has(providerSessionId),
        ),
      );
      if (kept.size > 0) retained.set(providerId, kept);
    }
    this.#spoken = retained;
  }
}

/**
 * Turns registry snapshots into attention decisions. It reviews only sessions
 * that actually changed, bounds how many updates one pass may evaluate, keeps a
 * single evaluation in flight per session, and defaults to silence whenever an
 * evaluator fails or returns something outside the decision contract.
 */
export class SessionAttentionReviewer {
  readonly #evaluator: AttentionEvaluator;
  readonly #now: () => number;
  readonly #maximumUpdatesPerReview: number;
  readonly #ledger: AttentionSpeechLedger;
  #observed = new Map<string, Map<string, NormalizedSession>>();
  #pending = new Map<string, Set<string>>();

  constructor(options: SessionAttentionReviewerOptions) {
    this.#evaluator = options.evaluator;
    this.#now = options.now ?? Date.now;
    this.#maximumUpdatesPerReview = positiveInteger(
      options.maximumUpdatesPerReview,
      ATTENTION_REVIEW_DEFAULTS.MAXIMUM_UPDATES_PER_REVIEW,
    );
    this.#ledger = new AttentionSpeechLedger({
      ...(options.now ? { now: options.now } : {}),
      ...(options.repeatWindowMs !== undefined ? { repeatWindowMs: options.repeatWindowMs } : {}),
    });
  }

  async review(sessions: readonly NormalizedSession[]): Promise<readonly AttentionReview[]> {
    this.#ledger.retain(sessions);

    const candidates: AttentionCandidate[] = [];
    for (const session of sessions) {
      if (this.#isPending(session)) continue;
      const update = attentionUpdate(session, this.#observedSession(session));
      if (update) candidates.push({ session, update });
    }

    const selected = candidates
      .sort((first, second) => second.session.observedAt - first.session.observedAt)
      .slice(0, this.#maximumUpdatesPerReview);

    // Sessions left out of this pass keep their previous baseline so the same
    // development is derived again once a slot frees up.
    this.#observed = this.#nextObserved(sessions, selected);
    for (const candidate of selected) this.#markPending(candidate.session);

    try {
      return await Promise.all(selected.map((candidate) => this.#reviewUpdate(candidate.update)));
    } finally {
      for (const candidate of selected) this.#clearPending(candidate.session);
    }
  }

  async #reviewUpdate(update: AttentionUpdate): Promise<AttentionReview> {
    const decision = await this.#evaluate(update);
    const identity: SessionIdentity = {
      providerId: update.providerId,
      providerSessionId: update.providerSessionId,
    };

    if (!decision) {
      return { ...identity, update, decision: silentAttention(this.#now()), suppressed: false };
    }
    if (decision.disposition === ATTENTION_DISPOSITION.SILENT) {
      return { ...identity, update, decision, suppressed: false };
    }
    if (!this.#ledger.shouldSpeak(identity, decision)) {
      return { ...identity, update, decision: silentAttention(this.#now()), suppressed: true };
    }

    this.#ledger.remember(identity, decision);
    return { ...identity, update, decision, suppressed: false };
  }

  async #evaluate(update: AttentionUpdate): Promise<AttentionDecision | undefined> {
    try {
      return await this.#evaluator.evaluate(update);
    } catch {
      // A background evaluator must never break session observation; a failed
      // review simply leaves Luke silent about that update.
      return undefined;
    }
  }

  #observedSession(session: NormalizedSession): NormalizedSession | undefined {
    return this.#observed.get(session.providerId)?.get(session.providerSessionId);
  }

  #nextObserved(
    sessions: readonly NormalizedSession[],
    selected: readonly AttentionCandidate[],
  ): Map<string, Map<string, NormalizedSession>> {
    const reviewed = new Map<string, Set<string>>();
    for (const candidate of selected) {
      const providerSessionIds = reviewed.get(candidate.session.providerId) ?? new Set<string>([]);
      providerSessionIds.add(candidate.session.providerSessionId);
      reviewed.set(candidate.session.providerId, providerSessionIds);
    }

    const next = new Map<string, Map<string, NormalizedSession>>();
    for (const session of sessions) {
      const baseline = reviewed.get(session.providerId)?.has(session.providerSessionId)
        ? session
        : this.#observedSession(session);
      if (!baseline) continue;
      const providerSessions = next.get(session.providerId) ?? new Map<string, NormalizedSession>();
      providerSessions.set(session.providerSessionId, baseline);
      next.set(session.providerId, providerSessions);
    }
    return next;
  }

  #isPending(session: NormalizedSession): boolean {
    return this.#pending.get(session.providerId)?.has(session.providerSessionId) === true;
  }

  #markPending(session: NormalizedSession): void {
    const providerSessionIds = this.#pending.get(session.providerId) ?? new Set<string>();
    providerSessionIds.add(session.providerSessionId);
    this.#pending.set(session.providerId, providerSessionIds);
  }

  #clearPending(session: NormalizedSession): void {
    const providerSessionIds = this.#pending.get(session.providerId);
    if (!providerSessionIds) return;
    providerSessionIds.delete(session.providerSessionId);
    if (providerSessionIds.size === 0) this.#pending.delete(session.providerId);
  }
}
