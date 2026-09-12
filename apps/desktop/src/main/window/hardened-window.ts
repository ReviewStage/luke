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
 * The two levels a panel window stands at: above every app window as the
 * panel, above the menu bar too as the takeover.
 */
export const WINDOW_LEVEL = {
  PANEL: "pop-up-menu",
  TAKEOVER: "screen-saver",
} as const;
type WindowLevel = (typeof WINDOW_LEVEL)[keyof typeof WINDOW_LEVEL];

/**
 * Puts a window at one of Luke's levels and, on macOS, dresses it there: on
 * every Space, out of Mission Control, no traffic lights, and stationary so
 * Show Desktop cannot slide it away. The level and the dressing are one
 * call because AppKit puts the managed collection behavior back on a window
 * whose level changes, and a window carrying managed beside stationary is
 * tiled by Mission Control like an ordinary app window — so every change of
 * level goes through here and ends with the stationary flag asserted again.
 */
export function dressMacWindow(window: BrowserWindow, level: WindowLevel): void {
  window.setAlwaysOnTop(true, level);
  if (process.platform !== "darwin") return;
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.setHiddenInMissionControl(true);
  window.setWindowButtonVisibility(false);
  keepWindowStationary(window);
}
