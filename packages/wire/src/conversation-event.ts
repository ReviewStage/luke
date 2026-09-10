/**
 * The low-volume facts recorded about a message beside it, each an event row
 * of its own: how a briefing's delivery went, from the offer `announce` wrote
 * through a device's claim to the spoken, pushed, or expired end, held while
 * a device reports quiet; and a rating the developer gave a message. The
 * speech kinds are read together — the latest of them on an announcement is
 * what says whether it was ever heard — so they are told from the rating.
 */

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
