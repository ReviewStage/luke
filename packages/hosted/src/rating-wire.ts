import {
  RATING_EVENT_PAYLOAD_FIELDS,
  type RatingEventPayload,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
} from "@sidecar/wire";
import { deviceWireIdSchema } from "./device-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * The rating endpoint's request and answer. A rating is a fact the developer
 * states about one of Luke's messages — up or down, a note if they left one,
 * and the device they said it from — and the service records it as an event
 * on that message. The request refuses a key it did not name, as every
 * request frame on this wire does; the answer ignores one a newer service
 * adds. The verdict and the note are the stored payload's own fields from
 * `@sidecar/wire`, spread here, so the wire and the row cannot say different
 * things.
 */

export type HostedMessageRatingRequest = RatingEventPayload & { deviceId: string };

export const hostedMessageRatingRequestSchema: Schema<HostedMessageRatingRequest> = s.record({
  ...RATING_EVENT_PAYLOAD_FIELDS,
  deviceId: deviceWireIdSchema,
});

/** What recording a rating answers: the event row's id and its place in the conversation's event sequence. */
export interface HostedMessageRatingAnswer {
  id: string;
  seq: number;
}

export const hostedMessageRatingAnswerSchema: Schema<HostedMessageRatingAnswer> = s.record(
  { id: s.text(), seq: countedNumber },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
