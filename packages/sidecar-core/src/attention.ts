import {
  ATTENTION_DISPOSITION,
  type AttentionDecision,
  type AttentionDisposition,
  type NormalizedSession,
  normalizeAttention,
  normalizeSessionIdentity,
  type SessionDetail,
  type SessionIdentity,
  type SessionStatus,
  silentAttention,
} from "./session";

export const ATTENTION_TRIGGER = {
  OBSERVED: "observed",
  STATUS_CHANGED: "status-changed",
  SUMMARY_CHANGED: "summary-changed",
  ERROR_REPORTED: "error-reported",
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
  MAXIMUM_UNAVAILABLE_RETRIES: 2,
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
 * The part of a session's context an evaluator is given.
 *
 * An evaluator is the one place session material leaves the machine, so this is
 * deliberately narrower than `SessionDetail`: it carries what the decision
 * turns on and nothing that only the local surface needs. The session's own
 * address and the change it published are identifiers, not evidence, so they
 * stay behind.
 */
export interface AttentionContext {
  repository?: string;
  branch?: string;
  activity?: string;
  error?: string;
}

/**
 * A bounded description of what changed for one session, and the only session
 * material an attention evaluator ever receives. It carries what a provider
 * wrote *about* a session — its title, its state, its own closing recap — and
 * never the transcript that sits behind them: no message history, file
 * contents, or command output.
 */
export interface AttentionUpdate extends SessionIdentity {
  trigger: AttentionTrigger;
  providerName: string;
  title: string;
  /**
   * The workspace the session is one chat of, by name, when its provider
   * groups them. A deliberate widening: this name used to leave the machine as
   * the title itself when a workspace was one row, and a readout that cannot
   * say which workspace a chat belongs to cannot identify the work out loud.
   */
  workspace?: string;
  status: SessionStatus;
  previousStatus?: SessionStatus;
  summary?: string;
  context?: AttentionContext;
  observedAt: number;
}

/** Narrows a session's observed detail to the fields an evaluator may receive. */
export function attentionContext(detail: SessionDetail): AttentionContext | undefined {
  const context: AttentionContext = {
    ...(detail.repository ? { repository: detail.repository } : {}),
    ...(detail.branch ? { branch: detail.branch } : {}),
    ...(detail.activity ? { activity: detail.activity } : {}),
    ...(detail.error ? { error: detail.error } : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

/** Reviews one bounded update and decides whether Luke should speak. */
export interface AttentionEvaluator {
  evaluate(update: AttentionUpdate): Promise<AttentionDecision | undefined>;
}

/** Why a reviewed update ended up with the decision it carries. */
export const ATTENTION_REVIEW_OUTCOME = {
  DECIDED: "decided",
  DEDUPLICATED: "deduplicated",
  SUPERSEDED: "superseded",
  UNAVAILABLE: "unavailable",
} as const;

export type AttentionReviewOutcome =
  (typeof ATTENTION_REVIEW_OUTCOME)[keyof typeof ATTENTION_REVIEW_OUTCOME];

/**
 * The decision a reviewer reached for one session. The two fields answer
 * different questions and must not be conflated: `decision` says whether the
 * session warrants attention and how urgently, and is what callers store, while
 * `outcome` says whether Luke should voice it now. A repeated development
 * carries a speaking `decision` with a `deduplicated` outcome — the session
 * still needs attention, but saying the same sentence again would be noise.
 */
export interface AttentionReview extends SessionIdentity {
  update: AttentionUpdate;
  decision: AttentionDecision;
  outcome: AttentionReviewOutcome;
}

export interface AttentionSpeechLedgerOptions {
  now?: () => number;
  repeatWindowMs?: number;
}

export interface SessionAttentionReviewerOptions {
  evaluator: AttentionEvaluator;
  /**
   * Reads a session as it stands right now. A model call takes long enough for
   * a provider to move a session on, so without this the reviewer cannot tell
   * that the state it reasoned about is gone.
   */
  currentSession?: (identity: SessionIdentity) => NormalizedSession | undefined;
  now?: () => number;
  repeatWindowMs?: number;
  maximumUpdatesPerReview?: number;
  /** How many extra passes may retry one update after an evaluator failure. */
  maximumUnavailableRetries?: number;
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

/**
 * What a session is running changes with every tool call, so it is deliberately
 * not a development: reviewing it would put a model call behind each one. Only
 * the state, a new failure, or a new recap is worth a decision.
 */
function attentionTrigger(
  session: NormalizedSession,
  previous: NormalizedSession | undefined,
): AttentionTrigger | undefined {
  if (!previous) return ATTENTION_TRIGGER.OBSERVED;
  if (previous.status !== session.status) return ATTENTION_TRIGGER.STATUS_CHANGED;
  if (previous.detail.error !== session.detail.error) return ATTENTION_TRIGGER.ERROR_REPORTED;
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

  const context = attentionContext(session.detail);
  const workspace = session.workspace?.name;
  return {
    providerId: session.providerId,
    providerSessionId: session.providerSessionId,
    trigger,
    providerName: session.provider.displayName,
    title: session.title,
    ...(workspace ? { workspace } : {}),
    status: session.status,
    ...(previous ? { previousStatus: previous.status } : {}),
    ...(session.summary ? { summary: session.summary } : {}),
    ...(context ? { context } : {}),
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
 * single evaluation in flight per session, discards a decision the session has
 * already moved past without consuming that development, and defaults to
 * silence whenever an evaluator fails or returns something outside the decision
 * contract.
 */
export class SessionAttentionReviewer {
  readonly #evaluator: AttentionEvaluator;
  readonly #currentSession:
    | ((identity: SessionIdentity) => NormalizedSession | undefined)
    | undefined;
  readonly #now: () => number;
  readonly #maximumUpdatesPerReview: number;
  readonly #ledger: AttentionSpeechLedger;
  readonly #maximumUnavailableRetries: number;
  #observed = new Map<string, Map<string, NormalizedSession>>();
  readonly #pending = new Map<string, Set<string>>();
  readonly #unavailableRetries = new Map<string, Map<string, number>>();

  constructor(options: SessionAttentionReviewerOptions) {
    this.#evaluator = options.evaluator;
    this.#currentSession = options.currentSession;
    this.#now = options.now ?? Date.now;
    this.#maximumUpdatesPerReview = positiveInteger(
      options.maximumUpdatesPerReview,
      ATTENTION_REVIEW_DEFAULTS.MAXIMUM_UPDATES_PER_REVIEW,
    );
    this.#maximumUnavailableRetries = nonNegativeNumber(
      options.maximumUnavailableRetries,
      ATTENTION_REVIEW_DEFAULTS.MAXIMUM_UNAVAILABLE_RETRIES,
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
      const evaluated = await Promise.all(
        selected.map((candidate) => this.#reviewUpdate(candidate.update)),
      );
      // Every speaking decision is settled here, in one uninterrupted step,
      // rather than as each evaluation lands: waiting on a slower sibling is
      // itself long enough for a provider to move a session on. Callers apply
      // the returned decisions without awaiting in between, so nothing can
      // change the session between this check and the write.
      return evaluated.map((review, index) => {
        const settled = this.#settle(review);
        const candidate = selected[index];
        // A development is only consumed once a decision was actually reached
        // about it. Anything else must stay derivable, or the update is lost.
        if (candidate && this.#keepsDevelopmentPending(settled, candidate.session)) {
          this.#reopen(candidate.session);
        }
        return settled;
      });
    } finally {
      for (const candidate of selected) this.#clearPending(candidate.session);
    }
  }

  /**
   * Decides whether an update stays derivable for a later pass.
   *
   * A superseded decision always does: the state changed, so the update cannot
   * recur on its own. An unavailable evaluator is retried a bounded number of
   * times instead, because the failure can be either a passing network blip —
   * where dropping "your session is waiting" would be a real miss — or a
   * standing misconfiguration, where retrying forever would hammer a paid API
   * every poll. Retries are per session and reset as soon as one succeeds.
   */
  #keepsDevelopmentPending(review: AttentionReview, session: NormalizedSession): boolean {
    if (review.outcome !== ATTENTION_REVIEW_OUTCOME.UNAVAILABLE) {
      // Every other outcome means the evaluator answered, so the failure streak
      // is over even when the answer itself could not be used. Counting a
      // superseded answer as a failure would let sparse blips accumulate until
      // one of them dropped a development.
      this.#clearUnavailableRetries(session);
      return review.outcome === ATTENTION_REVIEW_OUTCOME.SUPERSEDED;
    }

    const previous =
      this.#unavailableRetries.get(session.providerId)?.get(session.providerSessionId) ?? 0;
    const attempts = previous + 1;
    if (attempts > this.#maximumUnavailableRetries) {
      this.#clearUnavailableRetries(session);
      return false;
    }

    const providerAttempts =
      this.#unavailableRetries.get(session.providerId) ?? new Map<string, number>();
    providerAttempts.set(session.providerSessionId, attempts);
    this.#unavailableRetries.set(session.providerId, providerAttempts);
    return true;
  }

  #clearUnavailableRetries(session: NormalizedSession): void {
    const providerAttempts = this.#unavailableRetries.get(session.providerId);
    if (!providerAttempts) return;
    providerAttempts.delete(session.providerSessionId);
    if (providerAttempts.size === 0) this.#unavailableRetries.delete(session.providerId);
  }

  /**
   * Forgets what this session was last seen doing, so the next pass derives an
   * update for whatever it is doing then.
   *
   * Restoring the state from before the update would be more informative, but
   * it is not reliable: a session that round-trips back to that state during
   * the evaluation — complete, working, complete again — would compare equal to
   * the restored baseline and never be reviewed again. Forgetting guarantees a
   * fresh review at the cost of a `previousStatus` the reviewer can no longer
   * honestly report.
   */
  #reopen(session: NormalizedSession): void {
    const providerSessions = this.#observed.get(session.providerId);
    if (!providerSessions) return;
    providerSessions.delete(session.providerSessionId);
    if (providerSessions.size === 0) this.#observed.delete(session.providerId);
  }

  async #reviewUpdate(update: AttentionUpdate): Promise<AttentionReview> {
    const decision = await this.#evaluate(update);
    const identity: SessionIdentity = {
      providerId: update.providerId,
      providerSessionId: update.providerSessionId,
    };

    if (!decision) {
      return this.#silentReview(identity, update, ATTENTION_REVIEW_OUTCOME.UNAVAILABLE);
    }
    return { ...identity, update, decision, outcome: ATTENTION_REVIEW_OUTCOME.DECIDED };
  }

  /**
   * Admits a speaking decision only if it is still true and still new. A
   * decision the session has moved past would interrupt with news that is
   * already wrong, and it is deliberately not remembered, so the same sentence
   * stays available once the session genuinely needs it.
   *
   * A repeat keeps its disposition. Deduplication decides whether Luke says
   * something again, not whether the session still warrants attention: a second
   * turn really did finish, and silencing the decision because the sentence
   * matches a recent one would hide that development entirely.
   */
  #settle(review: AttentionReview): AttentionReview {
    if (review.decision.disposition === ATTENTION_DISPOSITION.SILENT) return review;
    if (this.#isSuperseded(review, review.update)) {
      return this.#silentReview(review, review.update, ATTENTION_REVIEW_OUTCOME.SUPERSEDED);
    }
    if (!this.#ledger.shouldSpeak(review, review.decision)) {
      return { ...review, outcome: ATTENTION_REVIEW_OUTCOME.DEDUPLICATED };
    }

    this.#ledger.remember(review, review.decision);
    return review;
  }

  /**
   * Reports whether the session moved past the state the evaluator reasoned
   * about. It compares every field a development can be derived from, so
   * `attentionTrigger` and this must be changed together: a dimension that can
   * open a review and cannot supersede one lets Luke speak about a failure the
   * session has already replaced or recovered from.
   */
  #isSuperseded(identity: SessionIdentity, update: AttentionUpdate): boolean {
    if (!this.#currentSession) return false;
    const current = this.#currentSession(identity);
    if (!current) return true;
    return (
      current.status !== update.status ||
      current.summary !== update.summary ||
      current.detail.error !== update.context?.error
    );
  }

  #silentReview(
    identity: SessionIdentity,
    update: AttentionUpdate,
    outcome: AttentionReviewOutcome,
  ): AttentionReview {
    return { ...identity, update, decision: silentAttention(this.#now()), outcome };
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
