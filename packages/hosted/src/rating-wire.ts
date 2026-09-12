import {
  effectSchema,
  MESSAGE_RATING,
  maximumRatingNoteLength,
  type RatingEventPayload,
  type Schema,
  s,
} from "@sidecar/wire";
import { emitJsonSchema, readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
import { deviceWireIdSchema } from "./device-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * The rating endpoint's request and answer. A rating is a fact the developer
 * states about one of Luke's messages — up or down, a note if they left one,
 * and the device they said it from — and the service records it as an event
 * on that message. The request refuses a key it did not name, as every
 * request frame on this wire does; the answer ignores one a newer service
 * adds. The verdict and the note are the stored payload's own fields from
 * `@sidecar/wire`, restated here as Effect `Schema`, so the wire and the row
 * cannot say different things.
 *
 * Every declaration below is composed directly as an Effect `Schema`, under
 * its own `<name>Effect` export; the plain `<name>` export beside it is the
 * same declaration read through `fromEffect` (the pattern P1-04 established
 * in `packages/wire/src/ui-message-metadata.ts`), which is what still
 * answers the facade's `read`/`parse` for `apps/web/server/hosted/message-rating.ts`'s
 * and this module's own test's callers. The facade twin is the strangler
 * shim P12-08 deletes, once every caller declares against the `Effect`
 * export directly.
 */

/**
 * The Effect schema a declaration was composed from, adapted to the facade
 * still-held callers use: `read` through `readEither`, `jsonSchema` through
 * the emitter walking the same schema.
 */
function fromEffect<Value, Encoded>(core: EffectSchema.Schema<Value, Encoded>): Schema<Value> {
  const read = readEither(core);
  return s.reader({
    read: (value) =>
      Either.match(read(value), {
        onLeft: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onRight: (value) => ({ ok: true, value }),
      }),
    jsonSchema: () => emitJsonSchema(core),
  });
}

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does. Each record states its own rule, because Effect hands a struct's
 * parse options down to the structs inside it.
 */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, the way `s.text()` reads one. */
function trimmedText(maximumChars?: number) {
  const core = EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: (value) => value.trim(),
    encode: (value) => value,
  }).pipe(
    EffectSchema.filter((value) => value.trim().length > 0, {
      schemaId: EffectSchema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
  );
  return maximumChars === undefined ? core : core.pipe(EffectSchema.maxLength(maximumChars));
}

export type HostedMessageRatingRequest = RatingEventPayload & { deviceId: string };

export const hostedMessageRatingRequestSchemaEffect = EffectSchema.Struct({
  rating: EffectSchema.Literal(...Object.values(MESSAGE_RATING)),
  note: EffectSchema.optionalWith(trimmedText(maximumRatingNoteLength), { exact: true }),
  deviceId: effectSchema(deviceWireIdSchema),
});

export const hostedMessageRatingRequestSchema: Schema<HostedMessageRatingRequest> = fromEffect(
  hostedMessageRatingRequestSchemaEffect,
);

/** What recording a rating answers: the event row's id and its place in the conversation's event sequence. */
export interface HostedMessageRatingAnswer {
  id: string;
  seq: number;
}

export const hostedMessageRatingAnswerSchemaEffect = tolerantRecord({
  id: trimmedText(),
  seq: effectSchema(countedNumber),
});

export const hostedMessageRatingAnswerSchema: Schema<HostedMessageRatingAnswer> = fromEffect(
  hostedMessageRatingAnswerSchemaEffect,
);
