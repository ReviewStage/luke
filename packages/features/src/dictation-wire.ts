import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

export const DICTATION_BOUNDS = {
  MAX_DURATION_MS: 120_000,
  MAX_AUDIO_BYTES: 1_000_000,
  AUDIO_BITS_PER_SECOND: 32_000,
  MAX_KEYWORDS: 50,
  MAX_KEYWORD_CHARS: 100,
} as const;

export const DICTATION_AUDIO_TYPE = "audio/webm";

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const KEYWORD_PATTERN = /^[^<>\r\n]*$/u;

const dictationKeywordSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(DICTATION_BOUNDS.MAX_KEYWORD_CHARS),
  EffectSchema.isPattern(KEYWORD_PATTERN),
);

export const dictationRequestSchema = EffectSchema.Struct({
  audio: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isPattern(BASE64_PATTERN),
  ),
  durationMs: countedNumber,
  keywords: EffectSchema.Array(dictationKeywordSchema).check(
    EffectSchema.isMaxLength(DICTATION_BOUNDS.MAX_KEYWORDS),
  ),
});

export const dictationAnswerSchema = EffectSchema.Struct({
  text: EffectSchema.String,
});
