/**
 * call-video-label.ts -- what a video call's tile and its toggles are called, for a reader and their hover: kept apart from the tile (`call-video-tile.tsx`), a chunk of its own while the Video calls experiment is off, so the composer's Video on and off can name themselves without it.
 */

/** What the tile says, for a reader and on screen. */
export const CALL_VIDEO_LABEL = {
  TILE: "Video call",
  CONNECTING: "Connecting video",
  ENDED: "Video ended",
  VIDEO_OFF: "Turn video off",
  VIDEO_ON: "Turn video on",
  RESTART: "Restart video",
} as const;
