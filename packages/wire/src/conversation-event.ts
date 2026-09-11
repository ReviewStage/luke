/**
 * The low-volume facts recorded about a message beside it, each an event row
 * of its own: how a briefing's delivery went, from the offer `announce` wrote
 * through a device's claim to the spoken, pushed, or expired end, held while
 * a device reports quiet; and a rating the developer gave a message. The
 * speech kinds are read together — the latest of them on an announcement is
 * what says whether it was ever heard — so they are told from the rating.
 */

import { type RecordOf, type Schema, type SchemaFields, s } from "./schema.js";

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

/** The developer's verdict on one of Luke's messages. */
export const MESSAGE_RATING = {
  UP: "up",
  DOWN: "down",
} as const;

export type MessageRating = (typeof MESSAGE_RATING)[keyof typeof MESSAGE_RATING];

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
export const RATING_EVENT_PAYLOAD_FIELDS = {
  rating: s.enumOf(Object.values(MESSAGE_RATING)),
  note: s.text({ max: maximumRatingNoteLength }).optional(),
} satisfies SchemaFields;

export type RatingEventPayload = RecordOf<typeof RATING_EVENT_PAYLOAD_FIELDS>;

export const RATING_EVENT_PAYLOAD: Schema<RatingEventPayload> = s.record(
  RATING_EVENT_PAYLOAD_FIELDS,
);
