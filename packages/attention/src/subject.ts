import {
  boundedText,
  maximumSessionSubjectLength,
  maximumSessionTitleLength,
  SESSION_COMPLETION_CAUSE,
  SESSION_LOCATION,
  type Session,
  type SessionIdentity,
  transcriptReadTailBytes,
} from "@sidecar/session";
import { isRecord, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The subject of a local session: one short phrase saying what its agent is
 * working on, derived by a model from the rendering of the session's own
 * transcript that the adapter already produces, bounded by the file tail it
 * reads and its per-line cuts. It exists because no observed field says this —
 * a title is the first message, an activity is the tool running now — and an
 * announcement that names the agent by its title names the work it stopped
 * doing.
 *
 * It mirrors the attention evaluator at every layer: a model's judgment about
 * one session, reaching no write path. It is the one place transcript content
 * reaches a model unbidden, so the input is the adapter's own bounded
 * rendering and nothing wider, travels as data behind a marker, and the model
 * is offered no tools; the line it answers is bounded again before it is
 * used. It is derived at the announcement and lives only inside the payload
 * that carries it, kept nowhere else.
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

/**
 * What a derivation is given, and the only session material a subject model
 * ever receives: the provider's name, the title as the developer's first
 * ask, and the transcript rendering. Identifiers and clocks never enter it.
 */
export interface SubjectInput {
  providerName: string;
  title: string;
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

export interface SessionSubjectDeriverOptions {
  evaluator: SubjectEvaluator;
  /**
   * Reads the transcript rendering of one local session, or nothing
   * when its provider keeps none this build can read. Supplied by the main
   * process, which alone reaches the adapters.
   */
  readTranscript: (identity: SessionIdentity) => Promise<string | undefined>;
  now?: () => number;
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
  // Refused rather than cut past the bound: a longer transcript is not an
  // input this build produced. A rendering is a lossy cut of the file tail it
  // was read from, so it cannot materially outrun those bytes.
  if (!isWireString(value.transcript)) return undefined;
  const transcript = value.transcript.trim();
  if (!transcript || transcript.length > transcriptReadTailBytes) return undefined;
  return { providerName, title, transcript };
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
 * Derives the subject of one session, from its transcript as it stands at the
 * moment of asking. It is stateless on purpose: the subject has one consumer,
 * the announcement about to be spoken, and that is the moment the transcript
 * holds the settled turn worth naming — a schedule that read on first sight
 * found little more than the title, and a cached phrase named where the work
 * had been. A session the rule excludes, an evaluator in its own quiet, a
 * provider with no transcript to read, and a derivation that fails all answer
 * nothing, and the announcement leads with its substance instead.
 */
export class SessionSubjectDeriver {
  readonly #evaluator: SubjectEvaluator;
  readonly #readTranscript: SessionSubjectDeriverOptions["readTranscript"];
  readonly #now: () => number;

  constructor(options: SessionSubjectDeriverOptions) {
    this.#evaluator = options.evaluator;
    this.#readTranscript = options.readTranscript;
    this.#now = options.now ?? Date.now;
  }

  async deriveFor(session: Session): Promise<string | undefined> {
    if (session.location !== SESSION_LOCATION.LOCAL) return undefined;
    if (session.completionCause === SESSION_COMPLETION_CAUSE.SESSION_CLOSED) return undefined;
    // A live realtime voice transcript is an exchange in progress, not work
    // to name, whether the session is a voice conversation of its own or an
    // ordinary one the developer is currently speaking into.
    if (session.realtimeVoice === true || session.realtimeVoiceLive === true) return undefined;
    const quietUntil = this.#evaluator.quietUntil?.();
    if (quietUntil !== undefined && quietUntil > this.#now()) return undefined;
    const transcript = await this.#transcript({
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    });
    if (!transcript) return undefined;
    const input: SubjectInput = {
      providerName: session.provider.displayName,
      title: session.title,
      transcript,
    };
    const derivation = await this.#evaluate(input);
    if (!derivation || derivation.subject === null) return undefined;
    return repeatsTitle(derivation.subject, session.title) ? undefined : derivation.subject;
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
      // A derivation must never break the announcement it decorates; a
      // failure leaves it without a subject.
      return undefined;
    }
  }
}
