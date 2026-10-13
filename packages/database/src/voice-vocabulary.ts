import { MESSAGE_ROLE } from "@sidecar/wire";

/** Why a session ended, as the Live API's `session.closed` names it. */
export const VOICE_CLOSE_REASON = {
  CLOSE_REQUESTED: "close_requested",
  EXPIRED: "expired",
  CONTENT: "content",
  REMOTE_HANGUP: "remote_hangup",
  CONNECTION_LOST: "connection_lost",
} as const;

export type VoiceCloseReason = (typeof VOICE_CLOSE_REASON)[keyof typeof VOICE_CLOSE_REASON];

/** Who the session hands a delegation to: the client that opened it. */
export const VOICE_DELEGATION_MODE = {
  CLIENT: "client",
} as const;

/** Who spoke a segment: the developer or Luke. A segment is never a system row. */
export const VOICE_SEGMENT_ROLE = {
  USER: MESSAGE_ROLE.USER,
  ASSISTANT: MESSAGE_ROLE.ASSISTANT,
} as const;

export type VoiceSegmentRole = (typeof VOICE_SEGMENT_ROLE)[keyof typeof VOICE_SEGMENT_ROLE];

/** Why an avatar session on a call ended. */
export const AVATAR_END_REASON = {
  USER: "user",
  MEDIA_LOST: "media_lost",
  MAX_DURATION: "max_duration",
  NO_CREDITS: "no_credits",
  UNAVAILABLE: "unavailable",
  ERROR: "error",
} as const;

export type AvatarEndReason = (typeof AVATAR_END_REASON)[keyof typeof AVATAR_END_REASON];
