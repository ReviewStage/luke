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
 * adds, which is now the reader's own grain rather than the declaration's —
 * an answer is read through `readEither(schema, { excess: EXCESS_KEYS.DROP })`.
 * The verdict and the note are the stored payload's own fields from
 * `@sidecar/wire`, restated here as Effect `Schema`, so the wire and the row
 * cannot say different things.
 *
 * Every declaration below is composed directly as an Effect `Schema` and
 * exported under its own name; `apps/web/server/hosted/message-rating.ts`
 * reads one through `readEither` and shows it through `emitJsonSchema`.
 */

/** A text settled with its ends trimmed, refused when nothing but whitespace stands. */
function trimmedText(maximumChars?: number) {
  const core = EffectSchema.Trim.check(EffectSchema.isNonEmpty());
  return maximumChars === undefined ? core : core.check(EffectSchema.isMaxLength(maximumChars));
}

export type HostedMessageRatingRequest = RatingEventPayload & { deviceId: string };

export const hostedMessageRatingRequestSchema = EffectSchema.Struct({
  rating: EffectSchema.Literals(Object.values(MESSAGE_RATING)),
  note: EffectSchema.optionalKey(trimmedText(maximumRatingNoteLength)),
  deviceId: deviceWireIdSchema,
});

/** What recording a rating answers: the event row's id and its place in the conversation's event sequence. */
export interface HostedMessageRatingAnswer {
  id: string;
  seq: number;
}

export const hostedMessageRatingAnswerSchema = EffectSchema.Struct({
  id: trimmedText(),
  seq: countedNumber,
});
