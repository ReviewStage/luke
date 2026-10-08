/**
 * The low-volume facts an earlier build recorded about a message beside it,
 * each an event row of its own: how a briefing's delivery went, from the
 * offer through a device's claim to the spoken, pushed, or expired end; and a
 * rating the developer gave a message. Nothing writes these now; the kinds
 * stay because the rows that carry them stand, and the rating's words because
 * the counted events an older build sent still name them.
 */

export const CONVERSATION_EVENT_KIND = {
  SPEECH_OFFERED: "speech.offered",
  SPEECH_CLAIMED: "speech.claimed",
  SPEECH_SPOKEN: "speech.spoken",
  SPEECH_PUSHED: "speech.pushed",
  SPEECH_EXPIRED: "speech.expired",
  RATING: "rating",
} as const;

export type ConversationEventKind =
  (typeof CONVERSATION_EVENT_KIND)[keyof typeof CONVERSATION_EVENT_KIND];

/** Every word a rating may say: a verdict, or its withdrawal. */
export const RATING_WORD = {
  UP: "up",
  DOWN: "down",
  WITHDRAWN: "withdrawn",
} as const;

export type RatingWord = (typeof RATING_WORD)[keyof typeof RATING_WORD];
