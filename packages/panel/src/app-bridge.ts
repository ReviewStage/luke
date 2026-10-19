/**
 * app-bridge.ts -- the one bridge this window reaches main through, and its act port, installed by its root before anything reads them.
 *
 * Every call the renderer makes across the sandbox, its acts, its state, the
 * events main sends it, goes through the `AppBridge` installed here rather
 * than through a global, so the root decides what answers: the desktop's
 * `window-root.tsx` installs the preload's Electron bridge, and a test installs a
 * fake of its own. The acts that have moved onto oRPC ride the window's act
 * port instead, whose client is installed beside it the same way. Note that
 * this is a module-level door rather than an Effect service or a React
 * context, because most of its callers are neither fibers nor components:
 * the act door's promises, the state atom's subscription, and the toasts'
 * callbacks all read it outside a render, and each reads it at the moment it
 * calls, never at module load.
 */

import type { AppBridge } from "@luke/host/bridge";
import type { ActPortClient } from "@luke/host/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";

let installed: AppBridge | undefined;
let installedActPort: ActPortClient | undefined;

/** Installs the bridge this window reaches main through; its root does this once, before anything is drawn. */
export function installAppBridge(bridge: AppBridge): void {
  installed = bridge;
}

/** The bridge this window's root installed. */
export function appBridge(): AppBridge {
  if (installed === undefined) throw new Error("No app bridge is installed in this window.");
  return installed;
}

/**
 * Installs this window's end of its act port, the other end of which its
 * root has handed main, and starts it; its root does this once, beside the
 * bridge. A shell that acts on some calls as they leave hands its client
 * `through` what does so, as the web app's does for a connect's press.
 */
export function installActPort(
  port: MessagePort,
  through: (client: ActPortClient) => ActPortClient = (client) => client,
): void {
  installActPortClient(through(createORPCClient(new RPCLink({ port }))));
  port.start();
}

/** Installs the act port's client itself, which a test answers with a fake of its own. */
export function installActPortClient(client: ActPortClient): void {
  installedActPort = client;
}

/** The act port's client this window's root installed. */
export function actPort(): ActPortClient {
  if (installedActPort === undefined) throw new Error("No act port is installed in this window.");
  return installedActPort;
}
