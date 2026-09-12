/**
 * The low-volume facts recorded about a message beside it, each an event row
 * of its own: how a briefing's delivery went, from the offer `announce` wrote
 * through a device's claim to the spoken, pushed, or expired end, held while
 * a device reports quiet; and a rating the developer gave a message. The
 * speech kinds are read together — the latest of them on an announcement is
 * what says whether it was ever heard — so they are told from the rating.
 */

import { Schema as EffectSchema } from "effect";

export const CONVERSATION_EVENT_KIND = {
  SPEECH_OFFERED: "speech.offered",
  SPEECH_CLAIMED: "speech.claimed",
  SPEECH_SPOKEN: "speech.spoken",
  SPEECH_PUSHED: "speech.pushed",
  SPEECH_EXPIRED: "speech.expired",
  SPEECH_HELD: "speech.held",
  RATING: "rating",
} as const;

export type ConversationEventKind =
  (typeof CONVERSATION_EVENT_KIND)[keyof typeof CONVERSATION_EVENT_KIND];

export type SpeechEventKind = Exclude<ConversationEventKind, typeof CONVERSATION_EVENT_KIND.RATING>;

export function isSpeechEventKind(kind: ConversationEventKind): kind is SpeechEventKind {
  return kind !== CONVERSATION_EVENT_KIND.RATING;
}

/** An integer at or above zero, the way `s.wholeNumber({ minimum: 0 })` reads one. */
const nonNegativeInteger = EffectSchema.Number.pipe(
  EffectSchema.finite(),
  EffectSchema.int(),
  EffectSchema.greaterThanOrEqualTo(0),
);

/** A trimmed text, refused when nothing but whitespace remains, the way `s.text()` reads one. */
const text = EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
  strict: true,
  decode: (value) => value.trim(),
  encode: (value) => value,
}).pipe(
  EffectSchema.filter((value) => value.length > 0, {
    schemaId: EffectSchema.MinLengthSchemaId,
    jsonSchema: { minLength: 1 },
  }),
);

/**
 * What `speech.offered` carries: the instant, in epoch milliseconds, past
 * which the offer stands for nothing. A briefing is about what just changed,
 * so one nobody said in time is marked unspoken rather than kept on offer,
 * and every reader of the offer — a claim, a push, the expiry sweep — takes
 * the bound from the offer itself rather than from a clock of its own.
 */
export const SPEECH_OFFERED_EVENT_PAYLOAD = EffectSchema.Struct({
  expiresAt: nonNegativeInteger,
});

export type SpeechOfferedEventPayload = EffectSchema.Schema.Type<
  typeof SPEECH_OFFERED_EVENT_PAYLOAD
>;

/**
 * What `speech.held` carries: the instant, in epoch milliseconds, the quiet
 * a device reported ends. While the hold stands nothing is pushed and
 * nothing is expired; when it lifts, the offer is not spoken stale but
 * re-decided, so the instant here is read only to know when the hold is
 * over, never to schedule speech.
 */
export const SPEECH_HELD_EVENT_PAYLOAD = EffectSchema.Struct({
  quietUntil: nonNegativeInteger,
});

export type SpeechHeldEventPayload = EffectSchema.Schema.Type<typeof SPEECH_HELD_EVENT_PAYLOAD>;

/**
 * What `speech.spoken` carries where the voice said it: the voice session,
 * and where on that session's own clock the speech began. The device that
 * spoke is the event row's own column.
 */
export const SPEECH_SPOKEN_EVENT_PAYLOAD = EffectSchema.Struct({
  voiceSessionId: text,
  atMs: nonNegativeInteger,
});

export type SpeechSpokenEventPayload = EffectSchema.Schema.Type<typeof SPEECH_SPOKEN_EVENT_PAYLOAD>;

/** Why an offer ended unspoken. */
export const SPEECH_EXPIRY_REASON = {
  /** The offer's own expiry passed with nobody having said it. */
  DUE: "due",
  /** A hold over it lifted; the brain re-decides against the roster as it then is rather than speaking it stale. */
  HOLD_RELEASED: "hold_released",
} as const;

export type SpeechExpiryReason = (typeof SPEECH_EXPIRY_REASON)[keyof typeof SPEECH_EXPIRY_REASON];

export const SPEECH_EXPIRED_EVENT_PAYLOAD = EffectSchema.Struct({
  reason: EffectSchema.Literal(...Object.values(SPEECH_EXPIRY_REASON)),
});

export type SpeechExpiredEventPayload = EffectSchema.Schema.Type<
  typeof SPEECH_EXPIRED_EVENT_PAYLOAD
>;

/** The developer's verdict on one of Luke's messages. */
export const MESSAGE_RATING = {
  UP: "up",
  DOWN: "down",
} as const;

export type MessageRating = (typeof MESSAGE_RATING)[keyof typeof MESSAGE_RATING];

export const MessageRatingSchema = EffectSchema.Literal(...Object.values(MESSAGE_RATING));

/** The most characters a rating's note may carry; it is the developer's own free text, so the bound is the whole of its shape. */
export const maximumRatingNoteLength = 500;

/**
 * What a `rating` event's payload holds: the verdict, and the developer's
 * note where they left one. The device that gave it and the message it is
 * about are the event row's own columns, and the turn behind the message is
 * a join away, so nothing of either is repeated here. A later rating is a
 * later event, never an update: the record keeps every verdict, and a read
 * takes the newest.
 */
export const RATING_EVENT_PAYLOAD = EffectSchema.Struct({
  rating: MessageRatingSchema,
  note: EffectSchema.optional(text.pipe(EffectSchema.maxLength(maximumRatingNoteLength))),
});

export type RatingEventPayload = EffectSchema.Schema.Type<typeof RATING_EVENT_PAYLOAD>;
