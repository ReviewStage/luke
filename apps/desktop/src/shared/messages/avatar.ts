/**
 * Where Luke's face on a call stands, as main holds it in the document:
 * `OFF` until the developer asks for video, `STARTING` while the service
 * mints the avatar and the call window waits on its first frame, `LIVE` once
 * that frame has drawn, and `ENDED` once the face is down while the call goes
 * on as voice, which is when the tile offers to restart it.
 */
export const AVATAR_STATUS = {
  OFF: "off",
  STARTING: "starting",
  LIVE: "live",
  ENDED: "ended",
} as const;

type AvatarStatus = (typeof AVATAR_STATUS)[keyof typeof AVATAR_STATUS];

/**
 * Why the face went down, as the tile says it: the developer turned video
 * off, the host lost the media socket, the session reached its cap, the
 * account's avatar credits ran out, the service could not put one up, or
 * anything else.
 */
export const AVATAR_END_REASON = {
  USER: "user",
  MEDIA_LOST: "media-lost",
  MAX_DURATION: "max-duration",
  NO_CREDITS: "no-credits",
  UNAVAILABLE: "unavailable",
  ERROR: "error",
} as const;

type AvatarEndReason = (typeof AVATAR_END_REASON)[keyof typeof AVATAR_END_REASON];

/**
 * The face as the document carries it, with why it went down once it has.
 * The room's address and viewer token are never here, because the document
 * reaches every window and the token may reach the call window alone.
 */
export interface AvatarState {
  status: AvatarStatus;
  /** Present once the status is `ENDED`, and only then. */
  endReason?: AvatarEndReason;
}

/** No face asked for: every launch's, and every call's until video is turned on. */
export const AVATAR_OFF: AvatarState = { status: AVATAR_STATUS.OFF };
