import { effectSchema, type Schema, s } from "@sidecar/wire";
import { emitJsonSchema, readEither, toSchemaRead } from "@sidecar/wire/effect";
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
 * Declared directly with Effect's `Schema.Struct` rather than through the
 * `s.*` facade; {@link fromEffect} is what still answers the facade's
 * `read`/`parse`/`jsonSchema` for the callers that hold one.
 */
export interface ConversationClearAnswer {
  readonly opened: string;
  /** Epoch milliseconds; the same instant the messages answer's main entry carries as `openedAt`. */
  readonly openedAt: number;
  readonly cleared: number;
}

/**
 * The Effect schema a declaration was composed from, adapted to the facade
 * still-held callers use: `read` through `readEither`, `jsonSchema` through
 * the emitter walking the same schema.
 */
function fromEffect<Value, Encoded>(core: EffectSchema.Schema<Value, Encoded>): Schema<Value> {
  const read = readEither(core);
  return s.reader({
    read: (value) => toSchemaRead(read(value)),
    jsonSchema: () => emitJsonSchema(core),
  });
}

/**
 * An integer at or above its minimum. Below it is malformed rather than too
 * large: a count of minus three is not a count that overflowed.
 */
const wholeNumber = (minimum: number) =>
  EffectSchema.Int.pipe(EffectSchema.greaterThanOrEqualTo(minimum));

const conversationClearAnswerCore = EffectSchema.Struct({
  opened: effectSchema(wireUuidSchema),
  openedAt: effectSchema(countedNumber),
  cleared: wholeNumber(0),
}).annotations({ parseOptions: { onExcessProperty: "ignore" } });

export const conversationClearAnswerSchema: Schema<ConversationClearAnswer> = fromEffect(
  conversationClearAnswerCore,
);
