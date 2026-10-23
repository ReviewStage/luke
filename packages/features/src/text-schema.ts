import { Schema as EffectSchema } from "effect";

/**
 * text-schema.ts -- the bounded text a wire module declares a field as: bounded, filled and bounded, or trimmed, filled, and bounded.
 *
 * Each is a builder rather than a constant, since every field names its own
 * bound. A model is shown some of these fields as a tool's input, so what
 * each emits is pinned by the JSON Schema goldens of the schemas built on it.
 */

/** A text held to a bound, empty allowed. */
export function boundedText(maximumChars: number) {
  return EffectSchema.String.check(EffectSchema.isMaxLength(maximumChars));
}

/** A text that is not empty, and bounded. */
export function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
export function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}
