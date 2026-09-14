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
const nonNegativeInteger = EffectSchema.Finite.check(
  EffectSchema.isInt(),
  EffectSchema.isGreaterThanOrEqualTo(0),
);

/** A trimmed text, refused when nothing but whitespace remains, the way `s.text()` reads one. */
const text = EffectSchema.Trim.check(EffectSchema.isNonEmpty());

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
  reason: EffectSchema.Literals(Object.values(SPEECH_EXPIRY_REASON)),
});

export type SpeechExpiredEventPayload = EffectSchema.Schema.Type<
  typeof SPEECH_EXPIRED_EVENT_PAYLOAD
>;

/** The developer's verdict as it stands on one of Luke's messages. */
export const MESSAGE_RATING = {
  UP: "up",
  DOWN: "down",
} as const;

export type MessageRating = (typeof MESSAGE_RATING)[keyof typeof MESSAGE_RATING];

export const MessageRatingSchema = EffectSchema.Literals(Object.values(MESSAGE_RATING));

/**
 * The one word a rating event says that is not a verdict: the developer took
 * the verdict back, and the message stands unrated, as it did before any
 * thumb. A press on the filled thumb writes it, and it is never folded onto a
 * message; a reader sees no rating where it is the newest word.
 */
export const RATING_WITHDRAWN = "withdrawn";

/** Every word a rating event's `rating` may say: a verdict, or its withdrawal. */
export const RATING_WORD = {
  ...MESSAGE_RATING,
  WITHDRAWN: RATING_WITHDRAWN,
} as const;

export type RatingWord = (typeof RATING_WORD)[keyof typeof RATING_WORD];

export const RatingWordSchema = EffectSchema.Literals(Object.values(RATING_WORD));

/** The most characters a rating's note may carry; it is the developer's own free text, so the bound is the whole of its shape. */
export const maximumRatingNoteLength = 500;

const ratingNote = EffectSchema.optional(
  text.check(EffectSchema.isMaxLength(maximumRatingNoteLength)),
);

/**
 * What a `rating` event's payload holds: the verdict, or the word that takes
 * one back, and the developer's note where they left one. The device that
 * gave it and the message it is about are the event row's own columns, and
 * the turn behind the message is a join away, so nothing of either is
 * repeated here. A later rating is a later event, never an update: the record
 * keeps every verdict and every withdrawal, and a read takes the newest.
 */
export const RATING_EVENT_PAYLOAD = EffectSchema.Struct({
  rating: RatingWordSchema,
  note: ratingNote,
});

export type RatingEventPayload = EffectSchema.Schema.Type<typeof RATING_EVENT_PAYLOAD>;

/**
 * A rating as it stands on a message once the events are folded: the newest
 * rating event's payload where that event says a verdict. A withdrawal is a
 * rating event and never a standing rating, so what a message page or a view
 * carries under this shape is always a thumb the developer has not taken back.
 */
export const STANDING_RATING = EffectSchema.Struct({
  rating: MessageRatingSchema,
  note: ratingNote,
});

export type StandingRating = EffectSchema.Schema.Type<typeof STANDING_RATING>;

/**
 * The newest rating event's payload as the message stands under it: the
 * payload itself where it says a verdict, nothing where it withdraws one or
 * where there is no payload to read, since an older verdict is not the
 * developer's last word either way.
 */
export function standingRating(
  payload: RatingEventPayload | undefined,
): StandingRating | undefined {
  if (payload === undefined || payload.rating === RATING_WITHDRAWN) return undefined;
  return { ...payload, rating: payload.rating };
}
