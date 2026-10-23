import assert from "node:assert/strict";
import type { Session, WebContents } from "electron";
import { test } from "vitest";
import { grantWindowPermissions } from "./window-permissions";

/**
 * What a page is answered as it asks Chromium for a permission: a window of
 * Luke's own may take the microphone and full screen, and nothing else, and
 * a page that is no window of Luke's is refused everything.
 */

type CheckHandler = Parameters<Session["setPermissionCheckHandler"]>[0];
type RequestHandler = Parameters<Session["setPermissionRequestHandler"]>[0];

// SAFETY: the pages are only identities the handlers compare, which nothing here reads further.
const own = {} as WebContents;
const foreign = {} as WebContents;

/** A session as Electron's holds its handlers, granted to `own` alone. */
function grantedSession() {
  let check: CheckHandler = null;
  let request: RequestHandler = null;
  grantWindowPermissions(
    {
      setPermissionCheckHandler: (handler) => {
        check = handler;
      },
      setPermissionRequestHandler: (handler) => {
        request = handler;
      },
    },
    (webContents) => webContents === own,
  );
  /** What a request is answered, as Electron hands it the details it does. */
  const asked = (
    webContents: WebContents,
    permission: Parameters<NonNullable<RequestHandler>>[1],
    details: Partial<Electron.MediaAccessPermissionRequest> = {},
  ): boolean => {
    let granted: boolean | undefined;
    // SAFETY: the handlers read only the media types of a request's details.
    request?.(webContents, permission, (answer) => (granted = answer), {
      requestingUrl: "luke://panel",
      isMainFrame: true,
      ...details,
    } as Electron.MediaAccessPermissionRequest);
    assert.notEqual(granted, undefined, "every request is answered");
    return granted === true;
  };
  /** What a check is answered. */
  const checked = (
    webContents: WebContents | null,
    permission: Parameters<NonNullable<CheckHandler>>[1],
    mediaType?: "audio" | "video",
  ): boolean =>
    check?.(webContents, permission, "luke://panel", {
      isMainFrame: true,
      ...(mediaType === undefined ? undefined : { mediaType }),
    } as Electron.PermissionCheckHandlerHandlerDetails) === true;
  return { asked, checked };
}

test("a window of Luke's own may fill the screen, as a video's Full screen asks", () => {
  const { asked, checked } = grantedSession();
  assert.equal(asked(own, "fullscreen"), true);
  assert.equal(checked(own, "fullscreen"), true);
});

test("a window of Luke's own takes the microphone, never the camera", () => {
  const { asked, checked } = grantedSession();
  assert.equal(asked(own, "media", { mediaTypes: ["audio"] }), true);
  assert.equal(asked(own, "media", { mediaTypes: ["audio", "video"] }), false);
  assert.equal(asked(own, "media", { mediaTypes: [] }), false);
  assert.equal(checked(own, "media", "audio"), true);
  assert.equal(checked(own, "media", "video"), false);
});

test("a window of Luke's own is refused every other permission", () => {
  const { asked, checked } = grantedSession();
  assert.equal(asked(own, "notifications"), false);
  assert.equal(asked(own, "pointerLock"), false);
  assert.equal(checked(own, "geolocation"), false);
});

test("a page that is no window of Luke's is refused full screen and the microphone alike", () => {
  const { asked, checked } = grantedSession();
  assert.equal(asked(foreign, "fullscreen"), false);
  assert.equal(asked(foreign, "media", { mediaTypes: ["audio"] }), false);
  assert.equal(checked(foreign, "fullscreen"), false);
  assert.equal(checked(null, "media", "audio"), false);
});
