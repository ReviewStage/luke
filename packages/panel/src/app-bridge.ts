/**
 * app-bridge.ts -- the one bridge this window reaches main through, installed by its root before anything reads it.
 *
 * Every call the renderer makes across the sandbox, its acts, its state, the
 * events main sends it, goes through the `AppBridge` installed here rather
 * than through a global, so the root decides what answers: the desktop's
 * `window-root.tsx` installs the preload's Electron bridge, and a test installs a
 * fake of its own. Note that this is a module-level door rather than an
 * Effect service or a React context, because most of its callers are neither
 * fibers nor components: the act door's promises, the state atom's
 * subscription, and the toasts' callbacks all read it outside a render, and
 * each reads it at the moment it calls, never at module load.
 */

import type { AppBridge } from "@luke/host/bridge";

let installed: AppBridge | undefined;

/** Installs the bridge this window reaches main through; its root does this once, before anything is drawn. */
export function installAppBridge(bridge: AppBridge): void {
  installed = bridge;
}

/** The bridge this window's root installed. */
export function appBridge(): AppBridge {
  if (installed === undefined) throw new Error("No app bridge is installed in this window.");
  return installed;
}
