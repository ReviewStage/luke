import type { RunMode } from "@luke/host";
import type { BrowserWindow } from "electron";

/**
 * The one posture every renderer window of Luke's runs under: the sandbox,
 * and the navigation refusals below, kept here once.
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
    // Chromium may throttle the page while its window is hidden, minimized,
    // or covered, since nothing in it runs real-time work nobody sees.
    backgroundThrottling: true,
    // The file viewer's video starts on its own as it opens, with no gesture
    // of its own, so the policy is asserted rather than left to Chromium's
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
