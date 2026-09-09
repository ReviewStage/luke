import type { RunMode } from "@sidecar/host";
import type { BrowserWindow } from "electron";
import { keepWindowStationary } from "../native/stationary-window";

/**
 * The one posture every renderer window of Luke's runs under. The panels and
 * the hidden voice window load the same bundle with the same reach, so the
 * sandbox and the navigation refusals live here once: a hardening fix applied
 * to one window class must not silently leave the other on the old posture.
 * The introduction runs in a panel, so what runs before the account gate is
 * hardened by the same call as everything after it.
 */
export function hardenedWebPreferences(input: {
  preloadPath: string;
  runMode: RunMode;
}): Electron.WebPreferences {
  return {
    preload: input.preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    devTools: input.runMode.takesFocus,
    backgroundThrottling: false,
    // Both window classes speak into a window that may never have seen a
    // user gesture: the panel is born non-focusable with pointer events
    // ignored until the first hover, and the takeover talks before the user
    // has touched anything at all. Playback must not answer to a gesture
    // requirement, so the policy is asserted rather than left to Chromium's
    // default.
    autoplayPolicy: "no-user-gesture-required",
  };
}

/** Denies window.open outright and any navigation away from the renderer's own URL. */
export function refuseForeignNavigation(window: BrowserWindow, rendererUrl: string): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
}

/**
 * The macOS dressing Luke's windows share: on every Space, out of Mission
 * Control, no traffic lights, and stationary so Show Desktop cannot slide
 * them away. The always-on-top level stays each window's own — the panel
 * rides above windows, the takeover above the menu bar too.
 */
export function dressMacWindow(window: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.setHiddenInMissionControl(true);
  window.setWindowButtonVisibility(false);
  keepWindowStationary(window);
}
