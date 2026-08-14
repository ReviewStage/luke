import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";

interface StationaryWindowAddon {
  /** Returns the window's resulting collection-behavior mask. */
  makeStationary(windowHandle: Buffer): number;
}

// The bundle is CommonJS, but an explicit require keeps esbuild from trying to
// bundle a path only known at runtime.
const requireAddon = createRequire(__filename);

function addonPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mac-stationary-window.node");
  }
  return path.join(app.getAppPath(), ".build", "native", "mac-stationary-window.node");
}

/**
 * Show Desktop scoops every app window aside, but the hardware notch the panel
 * poses as does not move, so neither may the panel. AppKit's stationary
 * collection behavior is what exempts a window from Exposé, and Electron only
 * sets it on `desktop`-type windows, which can never take keyboard focus — so
 * a small Node-API addon sets the flag on the panel's own NSWindow instead.
 */
export function keepWindowStationary(window: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  try {
    const addon = requireAddon(addonPath()) as StationaryWindowAddon;
    addon.makeStationary(window.getNativeWindowHandle());
  } catch (error) {
    console.warn("Stationary behavior unavailable; Show Desktop will move the panel", error);
  }
}
