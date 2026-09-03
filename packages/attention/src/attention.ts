import {
  ATTENTION_DISPOSITION,
  type AttentionDecision,
  type AttentionDisposition,
  attentionDecisionFromWire,
  boundedText,
  maximumSessionRecapExcerptLength,
  normalizeSessionIdentity,
  SESSION_COMPLETION_CAUSE,
  type Session,
  type SessionDetail,
  type SessionIdentity,
  type SessionStatus,
  silentAttention,
} from "@sidecar/session";
import { nonNegativeNumber, positiveInteger, type UnparsedWireValue } from "@sidecar/wire";

export const ATTENTION_TRIGGER = {
  OBSERVED: "observed",
  STATUS_CHANGED: "status-changed",
  RECAP_CHANGED: "recap-changed",
  ERROR_REPORTED: "error-reported",
} as const;

export type AttentionTrigger = (typeof ATTENTION_TRIGGER)[keyof typeof ATTENTION_TRIGGER];

export const ATTENTION_DECISION_SCHEMA_NAME = "attention_decision";

const ATTENTION_DISPOSITIONS: readonly AttentionDisposition[] =
  Object.values(ATTENTION_DISPOSITION);

/**
 * What each disposition means, in the wording an evaluator is shown. The
 * schema description and the evaluator instructions both come from here, so
 * they cannot drift.
 */
export const DISPOSITION_GUIDANCE = {
  [ATTENTION_DISPOSITION.SILENT]: "say nothing. This is the correct answer for most updates.",
  [ATTENTION_DISPOSITION.SPEAK_DURING_TURN]:
    "interrupt now, only when the session cannot progress until the developer acts.",
  [ATTENTION_DISPOSITION.SPEAK_AT_TURN_END]:
    "wait for a natural pause, then report a session that reached a resting point.",
} as const satisfies Record<AttentionDisposition, string>;

const ATTENTION_REVIEW_DEFAULTS = {
  REPEAT_WINDOW_MS: 10 * 60 * 1000,
  MAXIMUM_UPDATES_PER_REVIEW: 4,
  MAXIMUM_UNAVAILABLE_RETRIES: 2,
} as const;

/**
 * The decision contract an evaluator must satisfy. It is one judgment and no
 * words at all, deliberately: a background classifier scoring dispositions
 * under a character cap has no ear for how a sentence lands out loud, and a
 * sentence it wrote would reduce the voice to reciting. The voice words what
 * is said, from the same observed fields this decision was reached on.
 */
export const ATTENTION_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["disposition"],
  properties: {
    disposition: {
      type: "string",
      enum: ATTENTION_DISPOSITIONS,
      description: ATTENTION_DISPOSITIONS.map(
        (disposition) => `${disposition}: ${DISPOSITION_GUIDANCE[disposition]}`,
      ).join(" "),
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
   * groups them. A deliberate widening of what leaves the machine: a readout
   * that cannot say which workspace a chat belongs to cannot identify the
   * work out loud.
   */
  workspace?: string;
  status: SessionStatus;
  /** Local announcement context; intentionally absent from the evaluator prompt. */
  holdingForDeveloper?: boolean;
  previousStatus?: SessionStatus;
  /**
   * The bounded excerpt of the session's recap, never the retained recap
   * whole: the roster may keep a longer one for the surfaces that draw it,
   * but what leaves the machine in an update stays cut to
   * {@link maximumSessionRecapExcerptLength}.
   */
  recap?: string;
  context?: AttentionContext;
  observedAt: number;
}

/** Narrows a session's observed detail to the fields an evaluator may receive. */
export function attentionContext(detail: SessionDetail): AttentionContext | undefined {
  const context: AttentionContext = {};
  if (detail.repository) context.repository = detail.repository;
  if (detail.branch) context.branch = detail.branch;
  if (detail.activity) context.activity = detail.activity;
  if (detail.error) context.error = detail.error;
  return Object.keys(context).length > 0 ? context : undefined;
}

/** Reviews one bounded update and decides whether Luke should speak. */
export interface AttentionEvaluator {
  evaluate(update: AttentionUpdate): Promise<AttentionDecision | undefined>;
  /**
   * The model reviews are sent to, when this evaluator knows one. The keyed
   * evaluator names its own; the hosted evaluator's model belongs to the
   * service's build, so it is honestly absent rather than guessed.
   */
  readonly model?: string;
  /**
   * When the evaluator has stood itself down — a rate limit's quiet — the
   * moment it will take requests again, as epoch milliseconds. A reviewer
   * that asks first skips the pass whole: nothing is sent, no baseline
   * advances, and no per-session retry is spent on a refusal that was never
   * about the session. Absent or in the past means requests are welcome.
   */
  quietUntil?(): number | undefined;
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
 * still needs attention, but saying the same thing again would be noise.
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
  currentSession?: (identity: SessionIdentity) => Session | undefined;
  now?: () => number;
  repeatWindowMs?: number;
  maximumUpdatesPerReview?: number;
  /** How many extra passes may retry one update after an evaluator failure. */
  maximumUnavailableRetries?: number;
}

interface SpokenRecord {
  disposition: AttentionDisposition;
  /**
   * The observed fields the voice would use, as they stood when Luke last
   * spoke. This is wider than the fields that trigger a model review: activity
   * changes do not open reviews, but two reviewed permission prompts must not
   * collapse merely because their status is the same.
   */
  speech: readonly (string | undefined)[];
  spokenAt: number;
}

interface AttentionCandidate {
  session: Session;
  update: AttentionUpdate;
}

/**
 * Every field a development can be derived from. `attentionTrigger` and
 * `#isSuperseded` both walk this list, so adding a dimension is one edit: a
 * field that can open a review and cannot supersede one would let Luke speak
 * about a failure the session has already replaced or recovered from.
 */
const ATTENTION_DEVELOPMENT = [
  {
    trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
    ofSession: (session: Session) => session.status,
    ofUpdate: (update: AttentionUpdate) => update.status,
  },
  {
    trigger: ATTENTION_TRIGGER.ERROR_REPORTED,
    ofSession: (session: Session) => session.detail.error,
    ofUpdate: (update: AttentionUpdate) => update.context?.error,
  },
  {
    trigger: ATTENTION_TRIGGER.RECAP_CHANGED,
    // The excerpt is what an update carries, so both accessors speak in
    // excerpts: a recap that changed only past the excerpt is a difference
    // no evaluator could see, and treating it as a development would open
    // reviews the model must judge blind — and supersede ones it should not.
    ofSession: (session: Session) => attentionRecapExcerpt(session.recap),
    ofUpdate: (update: AttentionUpdate) => update.recap,
  },
] as const;

/** The one bounded slice of a recap that may leave the machine in an update. */
function attentionRecapExcerpt(recap: string | undefined): string | undefined {
  return boundedText(recap, maximumSessionRecapExcerptLength);
}

/** Fields that change what the voice would say, without opening extra model reviews. */
function speechValues(update: AttentionUpdate): readonly (string | undefined)[] {
  return [
    update.trigger === ATTENTION_TRIGGER.ERROR_REPORTED ? update.trigger : undefined,
    update.title,
    update.status,
    update.holdingForDeveloper ? "holding-for-developer" : undefined,
    update.context?.activity,
    update.context?.error,
    update.recap,
  ];
}

/**
 * What a session is running changes with every tool call, so it is deliberately
 * not a development: reviewing it would put a model call behind each one. Only
 * the state, a new failure, or a new recap is worth a decision.
 */
function attentionTrigger(
  session: Session,
  previous: Session | undefined,
): AttentionTrigger | undefined {
  if (!previous) return ATTENTION_TRIGGER.OBSERVED;
  for (const dimension of ATTENTION_DEVELOPMENT) {
    if (dimension.ofSession(previous) !== dimension.ofSession(session)) return dimension.trigger;
  }
  return undefined;
}

/**
 * Derives the bounded update worth reviewing, or nothing when a newly observed
 * session says the same thing it said last time. A repeated observation is not
 * a development, so it never reaches an evaluator.
 */
export function attentionUpdate(session: Session, previous?: Session): AttentionUpdate | undefined {
  const trigger = attentionTrigger(session, previous);
  if (!trigger) return undefined;

  const context = attentionContext(session.detail);
  const workspace = session.workspace?.name;
  const update: AttentionUpdate = {
    providerId: session.providerId,
    providerSessionId: session.providerSessionId,
    trigger,
    providerName: session.provider.displayName,
    title: session.title,
    status: session.status,
    observedAt: session.observedAt,
  };
  if (workspace) update.workspace = workspace;
  if (session.holdingForDeveloper === true) update.holdingForDeveloper = true;
  if (previous) update.previousStatus = previous.status;
  const recap = attentionRecapExcerpt(session.recap);
  if (recap) update.recap = recap;
  if (context) update.context = context;
  return update;
}

/**
 * Validates untrusted model output against the decision contract. Anything that
 * does not satisfy the contract is discarded rather than repaired, so a
 * malformed response leaves Luke silent.
 */
export function attentionDecisionFromModel(
  value: UnparsedWireValue,
  decidedAt: number,
): AttentionDecision | undefined {
  return attentionDecisionFromWire(value, decidedAt);
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

  /** Reports whether a development says something new enough to be worth speaking. */
  shouldSpeak(
    identity: SessionIdentity,
    decision: AttentionDecision,
    update: AttentionUpdate,
  ): boolean {
    if (decision.disposition === ATTENTION_DISPOSITION.SILENT) return false;

    const normalizedIdentity = normalizeSessionIdentity(identity);
    const record = this.#spoken
      .get(normalizedIdentity.providerId)
      ?.get(normalizedIdentity.providerSessionId);
    if (!record) return true;
    if (record.disposition !== decision.disposition) return true;
    const speech = speechValues(update);
    if (speech.some((value, index) => value !== record.speech[index])) return true;
    return this.#now() - record.spokenAt >= this.#repeatWindowMs;
  }

  remember(identity: SessionIdentity, decision: AttentionDecision, update: AttentionUpdate): void {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const providerRecords =
      this.#spoken.get(normalizedIdentity.providerId) ?? new Map<string, SpokenRecord>();
    providerRecords.set(normalizedIdentity.providerSessionId, {
      disposition: decision.disposition,
      speech: speechValues(update),
      spokenAt: this.#now(),
    });
    this.#spoken.set(normalizedIdentity.providerId, providerRecords);
  }

  /** Forgets a decision the caller could not deliver after all. */
  forget(identity: SessionIdentity): void {
    const normalizedIdentity = normalizeSessionIdentity(identity);
    const providerRecords = this.#spoken.get(normalizedIdentity.providerId);
    if (!providerRecords) return;
    providerRecords.delete(normalizedIdentity.providerSessionId);
    if (providerRecords.size === 0) this.#spoken.delete(normalizedIdentity.providerId);
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
 * that actually changed and only while their events are fresh, bounds how many
 * updates one pass may evaluate, keeps a single evaluation in flight per
 * session, discards a decision the session has already moved past without
 * consuming that development, and defaults to silence whenever an evaluator
 * fails or returns something outside the decision contract.
 */
export class SessionAttentionReviewer {
  readonly #evaluator: AttentionEvaluator;
  readonly #currentSession: ((identity: SessionIdentity) => Session | undefined) | undefined;
  readonly #now: () => number;
  readonly #maximumUpdatesPerReview: number;
  readonly #ledger: AttentionSpeechLedger;
  readonly #maximumUnavailableRetries: number;
  #observed = new Map<string, Map<string, Session>>();
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
    const ledgerOptions: AttentionSpeechLedgerOptions = {};
    if (options.now) ledgerOptions.now = options.now;
    if (options.repeatWindowMs !== undefined) ledgerOptions.repeatWindowMs = options.repeatWindowMs;
    this.#ledger = new AttentionSpeechLedger(ledgerOptions);
  }

  async review(sessions: readonly Session[]): Promise<readonly AttentionReview[]> {
    // An evaluator in its own quiet would answer every update with nothing,
    // and each nothing costs a per-session retry budgeted for real failures.
    // Skipping the pass before any baseline advances spends none of them:
    // every development stays derivable and is reviewed once the quiet ends.
    const quietUntil = this.#evaluator.quietUntil?.();
    if (quietUntil !== undefined && quietUntil > this.#now()) return [];
    this.#ledger.retain(sessions);

    const candidates: AttentionCandidate[] = [];
    const closedConsumed: Session[] = [];
    for (const session of sessions) {
      if (this.#isPending(session)) continue;
      if (session.completionCause === SESSION_COMPLETION_CAUSE.SESSION_CLOSED) {
        closedConsumed.push(session);
        continue;
      }
      const update = attentionUpdate(session, this.#observedSession(session));
      if (!update) continue;
      candidates.push({ session, update });
    }

    const selected = candidates
      .sort((first, second) => second.session.observedAt - first.session.observedAt)
      .slice(0, this.#maximumUpdatesPerReview);

    // Sessions left out of this pass keep their previous baseline so the same
    // development is derived again once a slot frees up.
    this.#observed = this.#nextObserved(sessions, [
      ...selected.map((candidate) => candidate.session),
      ...closedConsumed,
    ]);
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
   * Makes an approved update eligible for a fresh review when its caller had
   * to defer delivery. Forgetting both the speaking record and observation
   * baseline means the next pass reasons about the session as it stands then,
   * rather than replaying words that may have gone stale while held.
   */
  reconsider(identities: readonly SessionIdentity[]): void {
    for (const identity of identities) {
      this.#ledger.forget(identity);
      this.#reopen(identity);
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
  #keepsDevelopmentPending(review: AttentionReview, session: Session): boolean {
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

  #clearUnavailableRetries(session: Session): void {
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
  #reopen(identity: SessionIdentity): void {
    const providerSessions = this.#observed.get(identity.providerId);
    if (!providerSessions) return;
    providerSessions.delete(identity.providerSessionId);
    if (providerSessions.size === 0) this.#observed.delete(identity.providerId);
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
    if (!this.#ledger.shouldSpeak(review, review.decision, review.update)) {
      return { ...review, outcome: ATTENTION_REVIEW_OUTCOME.DEDUPLICATED };
    }

    this.#ledger.remember(review, review.decision, review.update);
    return review;
  }

  /**
   * Reports whether the session moved past the state the evaluator reasoned
   * about. It compares every field a development can be derived from, so a
   * dimension cannot open a review and fail to supersede it.
   */
  #isSuperseded(identity: SessionIdentity, update: AttentionUpdate): boolean {
    if (!this.#currentSession) return false;
    const current = this.#currentSession(identity);
    if (!current) return true;
    if (current.completionCause === SESSION_COMPLETION_CAUSE.SESSION_CLOSED) return true;
    return ATTENTION_DEVELOPMENT.some(
      (dimension) => dimension.ofSession(current) !== dimension.ofUpdate(update),
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

  #observedSession(session: Session): Session | undefined {
    return this.#observed.get(session.providerId)?.get(session.providerSessionId);
  }

  #nextObserved(
    sessions: readonly Session[],
    consumed: readonly Session[],
  ): Map<string, Map<string, Session>> {
    const reviewed = new Map<string, Set<string>>();
    for (const session of consumed) {
      const providerSessionIds = reviewed.get(session.providerId) ?? new Set<string>([]);
      providerSessionIds.add(session.providerSessionId);
      reviewed.set(session.providerId, providerSessionIds);
    }

    const next = new Map<string, Map<string, Session>>();
    for (const session of sessions) {
      const baseline = reviewed.get(session.providerId)?.has(session.providerSessionId)
        ? session
        : this.#observedSession(session);
      if (!baseline) continue;
      const providerSessions = next.get(session.providerId) ?? new Map<string, Session>();
      providerSessions.set(session.providerSessionId, baseline);
      next.set(session.providerId, providerSessions);
    }
    return next;
  }

  #isPending(session: Session): boolean {
    return this.#pending.get(session.providerId)?.has(session.providerSessionId) === true;
  }

  #markPending(session: Session): void {
    const providerSessionIds = this.#pending.get(session.providerId) ?? new Set<string>();
    providerSessionIds.add(session.providerSessionId);
    this.#pending.set(session.providerId, providerSessionIds);
  }

  #clearPending(session: Session): void {
    const providerSessionIds = this.#pending.get(session.providerId);
    if (!providerSessionIds) return;
    providerSessionIds.delete(session.providerSessionId);
    if (providerSessionIds.size === 0) this.#pending.delete(session.providerId);
  }
}
