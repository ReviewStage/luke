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

/** Who the session hands a delegation to: the client that opened it, or the Responses API directly. */
export const VOICE_DELEGATION_MODE = {
  CLIENT: "client",
  RESPONSES: "responses",
} as const;

/** Who spoke a segment: the developer or Luke. A segment is never a system row. */
export const VOICE_SEGMENT_ROLE = {
  USER: MESSAGE_ROLE.USER,
  ASSISTANT: MESSAGE_ROLE.ASSISTANT,
} as const;

export type VoiceSegmentRole = (typeof VOICE_SEGMENT_ROLE)[keyof typeof VOICE_SEGMENT_ROLE];

/**
 * What a session cost, as the Live API bills it: by session time. The API
 * bills the elapsed seconds even when the session never delivered a clean
 * `session.closed` — a connection lost, or a close that never arrived — so a
 * writer with only a number would have to record zero, understating a real
 * bill, or record its estimate as though the API had confirmed it. The flag
 * keeps the two apart: `confirmed` seconds are the API's own count from its
 * usage event, unconfirmed ones the writer's elapsed estimate.
 */
export interface VoiceSessionUsage {
  readonly seconds: number;
  readonly confirmed: boolean;
}
