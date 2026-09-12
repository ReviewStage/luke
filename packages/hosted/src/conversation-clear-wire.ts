import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * What Clear answers: the main conversation the service opened in place of
 * the one it stamped, the instant it opened — which is where the view's
 * window now starts, so a device can take the Clear to its own screen from
 * this answer alone rather than wait on a read that may not land — and how
 * many conversations the stamp reached: the main and every descendant of
 * it, or none when no main stood. Nothing of the stamped rows travels back;
 * the reads simply stop listing them.
 *
 * Declared directly with Effect's `Schema.Struct` and exported under its own
 * name.
 */
export interface ConversationClearAnswer {
  readonly opened: string;
  /** Epoch milliseconds; the same instant the messages answer's main entry carries as `openedAt`. */
  readonly openedAt: number;
  readonly cleared: number;
}

/**
 * An integer at or above its minimum. Below it is malformed rather than too
 * large: a count of minus three is not a count that overflowed.
 */
const wholeNumber = (minimum: number) =>
  EffectSchema.Int.pipe(EffectSchema.greaterThanOrEqualTo(minimum));

export const conversationClearAnswerSchema = EffectSchema.Struct({
  opened: wireUuidSchema,
  openedAt: countedNumber,
  cleared: wholeNumber(0),
}).annotations({ parseOptions: { onExcessProperty: "ignore" } });
