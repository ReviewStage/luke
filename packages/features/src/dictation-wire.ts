import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/**
 * dictation-wire.ts -- a clip the developer dictated into a message box, and the words it said.
 *
 * `POST /api/dictation` takes one short recording, WebM with Opus as
 * Chromium's recorder writes it, in base64, with how long it ran and the
 * words it is likely to say: the repository's name, the task's title, the
 * paths the plan names. The service hands the clip and those words to its
 * transcription model and answers the text, and keeps neither the clip nor
 * the text. A clip past the bounds below is refused as too large before
 * anything is sent upstream, so the desktop stops its recorder at the same
 * bound rather than learn it from a refusal.
 */

export const DICTATION_BOUNDS = {
  /** The longest clip taken: a message, not a meeting. */
  MAX_DURATION_MS: 120_000,
  /** The most bytes a clip may hold: two minutes of 32 kbps Opus is about half of it. */
  MAX_AUDIO_BYTES: 1_000_000,
  /** The bitrate the desktop records at, which is speech-clear and keeps two minutes well inside the byte bound. */
  AUDIO_BITS_PER_SECOND: 32_000,
  /** The most words a clip may name as likely to be said. */
  MAX_KEYWORDS: 50,
  /** The most characters one such word may spell: a path, not a paragraph. */
  MAX_KEYWORD_CHARS: 100,
} as const;

/** The one container a clip travels in, which is the MIME type Chromium's recorder writes Opus as. */
export const DICTATION_AUDIO_TYPE = "audio/webm";

/** Standard base64 in whole quanta, padded, with no data-URL prefix and no line breaks. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** One word on one line, without the angle brackets the transcription model refuses in a keyword. */
const KEYWORD_PATTERN = /^[^<>\r\n]*$/u;

/** A word the clip is likely to say, trimmed, on one line, and bounded. */
const dictationKeywordSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(DICTATION_BOUNDS.MAX_KEYWORD_CHARS),
  EffectSchema.isPattern(KEYWORD_PATTERN),
);

/**
 * One clip to transcribe (POST). The bounds on its length and its bytes are
 * the route's to answer as too large, so the shape here holds only what makes
 * it a clip at all; the words beside it are held to their bounds here.
 */
export const dictationRequestSchema = EffectSchema.Struct({
  /** The recording's bytes in base64. */
  audio: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isPattern(BASE64_PATTERN),
  ),
  /** How long the recording ran, in milliseconds, as the desktop timed it. */
  durationMs: countedNumber,
  keywords: EffectSchema.Array(dictationKeywordSchema).check(
    EffectSchema.isMaxLength(DICTATION_BOUNDS.MAX_KEYWORDS),
  ),
});

/** What the clip said, as the model wrote it; empty where it heard no words. */
export const dictationAnswerSchema = EffectSchema.Struct({
  text: EffectSchema.String,
});
