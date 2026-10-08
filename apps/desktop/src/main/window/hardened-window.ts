import type { RunMode } from "@sidecar/host";
import type { BrowserWindow } from "electron";

/**
 * The one posture every renderer window of Luke's runs under. The panels and
 * the hidden voice window load the same bundle with the same reach, so the
 * sandbox and the navigation refusals live here once: a hardening fix applied
 * to one window class must not silently leave the other on the old posture.
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
    // Luke's voice plays in the hidden voice window, which never sees a user
    // gesture of its own. Playback must not answer to a gesture requirement,
    // so the policy is asserted rather than left to Chromium's default.
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
