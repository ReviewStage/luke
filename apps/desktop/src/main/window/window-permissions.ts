import type { Session, WebContents } from "electron";

const GRANTED = {
  MEDIA: "media",
  FULLSCREEN: "fullscreen",
} as const;

const AUDIO = "audio";

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
