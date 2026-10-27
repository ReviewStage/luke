/**
 * window-permissions.ts -- what Luke's own windows may ask Chromium for: the microphone, for the voice, and full screen, for a video played in the file viewer.
 *
 * Every other permission is refused, and so is anything asked by a page that
 * is no window of Luke's own. The microphone is granted for audio alone,
 * never the camera. Full screen is granted because Electron asks the
 * session's request handler before a page's element may fill the screen,
 * so a refusal there leaves a video's own Full screen control doing nothing.
 */

import type { Session, WebContents } from "electron";

/** The permissions a window of Luke's own is granted, by Electron's names for them. */
const GRANTED = {
  MEDIA: "media",
  FULLSCREEN: "fullscreen",
} as const;

/** The one kind of media a window may capture. */
const AUDIO = "audio";

/** Grants Luke's own windows the microphone and full screen on `session`, and refuses every other ask. */
export function grantWindowPermissions(
  session: Pick<Session, "setPermissionCheckHandler" | "setPermissionRequestHandler">,
  ownWindow: (webContents: WebContents) => boolean,
): void {
  session.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (webContents === null || !ownWindow(webContents)) return false;
    if (permission === GRANTED.FULLSCREEN) return true;
    return permission === GRANTED.MEDIA && details.mediaType === AUDIO;
  });
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!ownWindow(webContents)) {
      callback(false);
      return;
    }
    if (permission === GRANTED.FULLSCREEN) {
      callback(true);
      return;
    }
    const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    callback(
      permission === GRANTED.MEDIA &&
        mediaTypes.length > 0 &&
        mediaTypes.every((mediaType: string) => mediaType === AUDIO),
    );
  });
}
