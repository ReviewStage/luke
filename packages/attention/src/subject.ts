import {
  boundedText,
  maximumSessionSubjectLength,
  maximumSessionTitleLength,
  transcriptReadTailBytes,
} from "@sidecar/session";
import { isRecord, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The subject contract the released desktop asked the hosted service to
 * derive: one short phrase saying what a local session's agent is working on,
 * read by a model from the bounded transcript rendering the client sent. The
 * desktop no longer derives subjects this way; released clients still ask, so
 * the validators, the schema, and the answer's shape stand here unchanged.
 * The input travels as data behind a marker, the model is offered no tools,
 * and the phrase is bounded again before it is answered.
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
