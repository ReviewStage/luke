import { MESSAGE_RATING, maximumRatingNoteLength, type RatingEventPayload } from "@sidecar/wire";
import { Schema as EffectSchema } from "effect";
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
 * Every declaration below is composed directly as an Effect `Schema` and
 * exported under its own name; `apps/web/server/hosted/message-rating.ts`
 * reads one through `readEither` and shows it through `emitJsonSchema`.
 */

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does. Each record states its own rule, because Effect hands a struct's
 * parse options down to the structs inside it.
 */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** A text settled with its ends trimmed, refused when nothing but whitespace stands. */
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

export const hostedMessageRatingRequestSchema = EffectSchema.Struct({
  rating: EffectSchema.Literal(...Object.values(MESSAGE_RATING)),
  note: EffectSchema.optionalWith(trimmedText(maximumRatingNoteLength), { exact: true }),
  deviceId: deviceWireIdSchema,
});

/** What recording a rating answers: the event row's id and its place in the conversation's event sequence. */
export interface HostedMessageRatingAnswer {
  id: string;
  seq: number;
}

export const hostedMessageRatingAnswerSchema = tolerantRecord({
  id: trimmedText(),
  seq: countedNumber,
});
