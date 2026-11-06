import type { RunMode } from "@repo/host";
import type { BrowserWindow } from "electron";

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
    backgroundThrottling: true,
    autoplayPolicy: "no-user-gesture-required",
  };
}

export function refuseForeignNavigation(window: BrowserWindow, rendererUrl: string): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
}
