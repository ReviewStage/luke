import {
  boundedText,
  maximumSessionRecapExcerptLength,
  maximumSessionSubjectLength,
  maximumSessionTitleLength,
  normalizeSessionIdentity,
  SESSION_COMPLETION_CAUSE,
  SESSION_LOCATION,
  SESSION_NOTICE_STATUS,
  type Session,
  type SessionIdentity,
  type SessionStatus,
  transcriptReadTailBytes,
} from "@sidecar/session";
import {
  isRecord,
  isWireString,
  nonNegativeNumber,
  positiveInteger,
  text,
  type UnparsedWireValue,
} from "@sidecar/wire";

/**
 * The subject of a local session: one short phrase saying what its agent is
 * working on, derived by a model from the rendering of the session's own
 * transcript that the adapter already produces, bounded by the file tail it
 * reads and its per-line cuts. It exists because no observed field says this —
 * a title is the first message, an activity is the tool running now, a recap
 * is the latest settled turn — and an announcement that names the agent by
 * its title names the work it stopped doing.
 *
 * It mirrors the attention evaluator at every layer: a model's judgment about
 * one session, kept beside provider-owned state, reaching no write path. It
 * is the one place transcript content reaches a model unbidden, so the input
 * is the adapter's own bounded rendering and nothing wider, travels as data
 * behind a marker, and the model is offered no tools; the line it answers is
 * bounded again before it is kept.
 */

export const SUBJECT_SCHEMA_NAME = "session_subject";

export const SUBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject"],
  properties: {
    subject: {
      type: ["string", "null"],
      description:
        `A short phrase, under ${maximumSessionSubjectLength} characters, naming what the agent ` +
        "is working on right now, or null when the transcript does not support one.",
    },
  },
};

const SUBJECT_DERIVATION_DEFAULTS = {
  /** How long one session's subject stands before an edge may re-derive it. */
  FLOOR_MS: 3 * 60_000,
  MAXIMUM_DERIVATIONS_PER_PASS: 2,
  MAXIMUM_UNAVAILABLE_RETRIES: 2,
} as const;

const NOTICE_STATUSES: ReadonlySet<SessionStatus> = new Set(Object.values(SESSION_NOTICE_STATUS));

/**
 * What a derivation is given, and the only session material a subject model
 * ever receives: the provider's name, the title as the developer's first
 * ask, the bounded recap where one stands, and the transcript rendering.
 * Identifiers and clocks never enter it.
 */
export interface SubjectInput {
  providerName: string;
  title: string;
  recap?: string;
  transcript: string;
}

/** One derived line, or the model's honest `null` when the transcript will not support one. */
export interface SubjectDerivation {
  subject: string | null;
}

/** Derives one bounded input into a subject, or nothing when it cannot answer. */
export interface SubjectEvaluator {
  derive(input: SubjectInput): Promise<SubjectDerivation | undefined>;
  readonly model?: string;
  /** As on the attention evaluator: the moment held-back requests resume. */
  quietUntil?(): number | undefined;
}

/** What the deriver settled for one session. */
export interface SubjectResult extends SessionIdentity {
  subject: string | undefined;
}

export interface SessionSubjectDeriverOptions {
  evaluator: SubjectEvaluator;
  /**
   * Reads the transcript rendering of one local session, or nothing
   * when its provider keeps none this build can read. Supplied by the main
   * process, which alone reaches the adapters.
   */
  readTranscript: (identity: SessionIdentity) => Promise<string | undefined>;
  currentSession?: (identity: SessionIdentity) => Session | undefined;
  now?: () => number;
  floorMs?: number;
  maximumDerivationsPerPass?: number;
  maximumUnavailableRetries?: number;
}

interface SubjectRecord {
  /** The status the session held when its subject was last settled. */
  status: SessionStatus;
  derivedAt: number;
  /** Whether a notice edge landed while the floor held, owed to the next pass past it. */
  edgeOwed: boolean;
}

/**
 * Validates untrusted model output against the subject contract. A missing
 * or malformed answer is discarded rather than repaired; a `null` is the
 * model's own answer that nothing supports a subject and is kept as such.
 */
export function subjectDerivationFromModel(
  value: UnparsedWireValue,
): SubjectDerivation | undefined {
  if (!isRecord(value)) return undefined;
  if (value.subject === null) return { subject: null };
  if (!isWireString(value.subject)) return undefined;
  const subject = boundedSubject(value.subject);
  return { subject: subject ?? null };
}

/** One line, cut to the bound, or nothing when there is nothing in it. */
export function boundedSubject(value: string | undefined): string | undefined {
  return boundedText(value?.replace(/\s+/g, " "), maximumSessionSubjectLength);
}

/** The rendering as it travels: whole, trimmed, or nothing when there is nothing in it. */
export function subjectTranscript(rendering: string): string | undefined {
  const trimmed = rendering.trim();
  return trimmed || undefined;
}

/**
 * Validates a subject input arriving as untrusted JSON — a hosted derivation
 * request — down to the fields the prompt reads, each held to its bound.
 */
export function subjectInputFromWire(value: UnparsedWireValue): SubjectInput | undefined {
  if (!isRecord(value)) return undefined;
  const providerName = boundedText(text(value.providerName), maximumSessionTitleLength);
  const title = boundedText(text(value.title), maximumSessionTitleLength);
  if (!providerName || !title) return undefined;
  // Refused rather than cut past the bounds: a longer transcript or recap is
  // not an input this build produced. A rendering is a lossy cut of the file
  // tail it was read from, so it cannot materially outrun those bytes.
  if (!isWireString(value.transcript)) return undefined;
  const transcript = value.transcript.trim();
  if (!transcript || transcript.length > transcriptReadTailBytes) return undefined;
  if (value.recap !== undefined && !isWireString(value.recap)) return undefined;
  const recap = value.recap?.trim();
  if (recap !== undefined && recap.length > maximumSessionRecapExcerptLength) return undefined;
  return { providerName, title, transcript, ...(recap ? { recap } : undefined) };
}

/**
 * A subject that only hands the title back has derived nothing: the point of
 * the line is to name where the work has got to, and the title is where it
 * began. Compared loosely, so punctuation and case cannot smuggle it through.
 */
function repeatsTitle(subject: string, title: string): boolean {
  const fold = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const foldedSubject = fold(subject);
  return foldedSubject.length > 0 && foldedSubject === fold(title);
}

/**
 * Turns registry snapshots into subjects for the local sessions worth one.
 *
 * It derives on first sight and again when a session enters a notice status
 * (waiting, error, complete), since that is when an announcement about it is
 * likely and when its transcript has a settled turn to read. A per-session
 * floor keeps a session that bounces between states from being re-read every
 * pass; an edge that lands inside the floor is owed, not lost. One derivation
 * is in flight per session, a pass derives a bounded few, an evaluator in its
 * own quiet is not asked, and a failed derivation is retried a bounded number
 * of times before the session settles for no subject until its next edge.
 */
export class SessionSubjectDeriver {
  readonly #evaluator: SubjectEvaluator;
  readonly #readTranscript: SessionSubjectDeriverOptions["readTranscript"];
  readonly #currentSession: SessionSubjectDeriverOptions["currentSession"];
  readonly #now: () => number;
  readonly #floorMs: number;
  readonly #maximumDerivationsPerPass: number;
  readonly #maximumUnavailableRetries: number;
  readonly #records = new Map<string, Map<string, SubjectRecord>>();
  readonly #pending = new Map<string, Set<string>>();
  readonly #unavailableRetries = new Map<string, Map<string, number>>();

  constructor(options: SessionSubjectDeriverOptions) {
    this.#evaluator = options.evaluator;
    this.#readTranscript = options.readTranscript;
    this.#currentSession = options.currentSession;
    this.#now = options.now ?? Date.now;
    this.#floorMs = nonNegativeNumber(options.floorMs, SUBJECT_DERIVATION_DEFAULTS.FLOOR_MS);
    this.#maximumDerivationsPerPass = positiveInteger(
      options.maximumDerivationsPerPass,
      SUBJECT_DERIVATION_DEFAULTS.MAXIMUM_DERIVATIONS_PER_PASS,
    );
    this.#maximumUnavailableRetries = nonNegativeNumber(
      options.maximumUnavailableRetries,
      SUBJECT_DERIVATION_DEFAULTS.MAXIMUM_UNAVAILABLE_RETRIES,
    );
  }

  async derive(sessions: readonly Session[]): Promise<readonly SubjectResult[]> {
    const quietUntil = this.#evaluator.quietUntil?.();
    if (quietUntil !== undefined && quietUntil > this.#now()) return [];
    this.#retain(sessions);

    const now = this.#now();
    const candidates: Session[] = [];
    for (const session of sessions) {
      if (session.location !== SESSION_LOCATION.LOCAL) continue;
      if (session.completionCause === SESSION_COMPLETION_CAUSE.SESSION_CLOSED) continue;
      // A live realtime voice transcript is an exchange in progress, not work
      // to name, whether the session is a voice conversation of its own or an
      // ordinary one the developer is currently speaking into; either still
      // keeps its record above so the exchange ending is not mistaken for
      // first sight.
      if (session.realtimeVoice === true || session.realtimeVoiceLive === true) continue;
      if (this.#isPending(session)) continue;
      if (this.#isDue(session, now)) candidates.push(session);
    }

    const selected = candidates
      .sort((first, second) => second.observedAt - first.observedAt)
      .slice(0, this.#maximumDerivationsPerPass);
    for (const session of selected) this.#markPending(session);

    try {
      const results = await Promise.all(selected.map((session) => this.#deriveOne(session)));
      return results.flatMap((result) => (result ? [result] : []));
    } finally {
      for (const session of selected) this.#clearPending(session);
    }
  }

  /**
   * Whether this pass should read the session. First sight always is. After
   * that only an edge into a notice status is, and only once the floor since
   * the last derivation has passed — an edge inside the floor is remembered
   * as owed so the next pass past it derives.
   */
  #isDue(session: Session, now: number): boolean {
    const record = this.#record(session);
    if (!record) return true;
    const entered = record.status !== session.status && NOTICE_STATUSES.has(session.status);
    if (entered) record.edgeOwed = true;
    record.status = session.status;
    if (!record.edgeOwed) return false;
    return now - record.derivedAt >= this.#floorMs;
  }

  async #deriveOne(session: Session): Promise<SubjectResult | undefined> {
    const identity: SessionIdentity = {
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    };
    const transcript = await this.#transcript(identity);
    if (!transcript) {
      // A provider with no transcript to read has no subject to derive, and
      // asking again on the next edge would read nothing again; settle it.
      this.#settle(session);
      return undefined;
    }
    const input: SubjectInput = {
      providerName: session.provider.displayName,
      title: session.title,
      transcript,
      ...(session.recap
        ? { recap: boundedText(session.recap, maximumSessionRecapExcerptLength) }
        : undefined),
    };
    const derivation = await this.#evaluate(input);
    if (!derivation) {
      if (this.#spendUnavailableRetry(session)) return undefined;
      this.#settle(session);
      return undefined;
    }
    this.#clearUnavailableRetries(session);
    this.#settle(session);
    // A session gone by the time the answer lands has nothing to attach a
    // subject to; the caller's registry would refuse it anyway.
    if (this.#currentSession && !this.#currentSession(identity)) return undefined;
    const subject =
      derivation.subject !== null && !repeatsTitle(derivation.subject, session.title)
        ? derivation.subject
        : undefined;
    return { ...identity, subject };
  }

  #settle(session: Session): void {
    const normalized = normalizeSessionIdentity(session);
    const records = this.#records.get(normalized.providerId) ?? new Map<string, SubjectRecord>();
    records.set(normalized.providerSessionId, {
      status: session.status,
      derivedAt: this.#now(),
      edgeOwed: false,
    });
    this.#records.set(normalized.providerId, records);
  }

  /** Whether a failed derivation stays due for another pass. */
  #spendUnavailableRetry(session: Session): boolean {
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

  async #transcript(identity: SessionIdentity): Promise<string | undefined> {
    try {
      const rendering = await this.#readTranscript(identity);
      return rendering ? subjectTranscript(rendering) : undefined;
    } catch {
      return undefined;
    }
  }

  async #evaluate(input: SubjectInput): Promise<SubjectDerivation | undefined> {
    try {
      return await this.#evaluator.derive(input);
    } catch {
      // A background derivation must never break observation; a failure
      // leaves the session without a subject, and the announcement leads
      // with its substance instead.
      return undefined;
    }
  }

  #record(session: Session): SubjectRecord | undefined {
    const normalized = normalizeSessionIdentity(session);
    return this.#records.get(normalized.providerId)?.get(normalized.providerSessionId);
  }

  #retain(sessions: readonly Session[]): void {
    const live = new Map<string, Set<string>>();
    for (const session of sessions) {
      const normalized = normalizeSessionIdentity(session);
      const ids = live.get(normalized.providerId) ?? new Set<string>();
      ids.add(normalized.providerSessionId);
      live.set(normalized.providerId, ids);
    }
    for (const [providerId, records] of this.#records) {
      const ids = live.get(providerId);
      for (const providerSessionId of records.keys()) {
        if (!ids?.has(providerSessionId)) records.delete(providerSessionId);
      }
      if (records.size === 0) this.#records.delete(providerId);
    }
  }

  #isPending(session: Session): boolean {
    return this.#pending.get(session.providerId)?.has(session.providerSessionId) === true;
  }

  #markPending(session: Session): void {
    const ids = this.#pending.get(session.providerId) ?? new Set<string>();
    ids.add(session.providerSessionId);
    this.#pending.set(session.providerId, ids);
  }

  #clearPending(session: Session): void {
    const ids = this.#pending.get(session.providerId);
    if (!ids) return;
    ids.delete(session.providerSessionId);
    if (ids.size === 0) this.#pending.delete(session.providerId);
  }
}
