/**
 * call-video-tile-model.ts -- what the call's video tile draws and offers, from the avatar's status and whether a picture is handed.
 *
 * The tile is Luke's face on the call, a picture of him LiveAvatar renders
 * and the call window shows. Everything it draws and every press it offers
 * is read here from what the tile is handed, so the tile itself decides
 * nothing and a test reads its answer without a window.
 */

/** Where the call's video stands, in the tile's own terms. */
export const CALL_VIDEO_STATUS = {
  /** The avatar is asked for and its room is not yet drawing. */
  CONNECTING: "connecting",
  /** The avatar is drawing Luke. */
  LIVE: "live",
  /** The video ended on its own (a lost room, the session's cap); the call goes on as voice. */
  ENDED: "ended",
} as const;

export type CallVideoStatus = (typeof CALL_VIDEO_STATUS)[keyof typeof CALL_VIDEO_STATUS];

/** The words the tile says over its still frame. */
export const CALL_VIDEO_LABEL = {
  CONNECTING: "Starting video",
  ENDED: "Video ended",
  VIDEO_OFF: "Turn off video",
  RESTART: "Restart video",
} as const;

export interface CallVideoTileModel {
  /** Whether the live picture is drawn, rather than Luke's still frame. */
  readonly picture: boolean;
  /** The line over the still frame, absent while there is nothing to say. */
  readonly caption: string | undefined;
  /** Whether the tile offers to turn the video off, back to a voice call. */
  readonly videoOff: boolean;
  /** Whether the tile offers to start the video again. */
  readonly restart: boolean;
}

/**
 * The tile for a status and a picture. Note that a live call with no picture
 * handed draws the still frame with nothing said over it, because that is
 * both the beat before a room's first track arrives and the smoke fixture,
 * which has no room to hand one. Hang up is offered in every state, so it
 * is not a field.
 */
export function callVideoTile(input: {
  status: CallVideoStatus;
  picture: boolean;
}): CallVideoTileModel {
  const { status, picture } = input;
  if (status === CALL_VIDEO_STATUS.ENDED) {
    return { picture: false, caption: CALL_VIDEO_LABEL.ENDED, videoOff: false, restart: true };
  }
  const live = status === CALL_VIDEO_STATUS.LIVE;
  return {
    picture: live && picture,
    caption: live ? undefined : CALL_VIDEO_LABEL.CONNECTING,
    videoOff: true,
    restart: false,
  };
}
