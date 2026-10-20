/**
 * window-root.tsx -- what every window's entry runs to draw: the one root, the surface it mounts once the window's document reads, and tracing once it has drawn.
 *
 * Each window role has an entry of its own, so a window parses only the
 * surface it mounts: the panels `index.tsx`, the hidden voice window
 * `voice/index.tsx`, and the floating call window `call/index.tsx`, each
 * loaded by its own document, and the code they have in common lands in
 * shared chunks. This module is the startup they share, and a runtime edge
 * (`tools/anti-slop/effect-edges.json`) where it runs the first read: it is
 * evaluated once per window, so no two windows share a browser registry.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { ACT_PORT, type PreloadBridge } from "@luke/host/bridge";
import { actPort, installActPort, installAppBridge, openPushStream } from "@luke/panel/app-bridge";
import { installAppPlatform } from "@luke/panel/app-platform";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { DESKTOP_PLATFORM } from "./desktop-platform";
import { BLANK_WINDOW, startDesktopSentry } from "./desktop-sentry";
import { createReportingRoot } from "./desktop-sentry-root";

/**
 * Installs the window's bridge and platform, draws `surface` into its root
 * once the window's document has been read, and then starts its tracing. A
 * window whose document cannot be read mounts nothing: a fallback would
 * protect nothing.
 */
export function mountWindow(surface: ReactNode): void {
  // The desktop's bridge is the one the preload exposed as `window.luke`, and
  // this is the one place that global is read: everything else reaches main
  // through `appBridge()`, which reads what is installed here before anything
  // below subscribes or draws. What only the shell can do is answered beside
  // it, through `appPlatform()`, by the desktop's own acts and events.
  const preloadWindow: Window & { readonly luke?: PreloadBridge } = window;
  if (preloadWindow.luke === undefined) throw new Error("The preload's bridge is missing");
  // The window's act port, as oRPC's Electron adapter opens one: this page
  // keeps one end and posts the other to itself, where the preload takes it
  // to main (`apps/desktop/src/main/bridge-host.ts`).
  const actPortChannel = new MessageChannel();
  window.postMessage(ACT_PORT.REQUEST, "*", [actPortChannel.port2]);
  installActPort(actPortChannel.port1);
  // What main pushes this window arrives on one stream of that port, opened
  // now and heard through the bridge's own listeners beside the preload's calls.
  const pushes = openPushStream(actPort());
  installAppBridge({ ...preloadWindow.luke, ...pushes.listeners });
  installAppPlatform(DESKTOP_PLATFORM);

  // Every window's tracing and error reports, from Sentry's SDK loaded once
  // the window has drawn (`desktop-sentry.ts`), so no window parses it on
  // its way to its first paint.
  const sentry = startDesktopSentry();

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Renderer root element is missing");
  const draw = createReportingRoot(rootElement, sentry);

  void (async () => {
    try {
      // Main listens on the push stream before the document is read, so a
      // document pushed while the read is in flight is heard, not lost.
      await pushes.opened;
      await Effect.runPromise(appStateFirstRead);
    } catch (error) {
      console.error("The window's state could not be read; nothing is drawn.", error);
      // A blank window is a failure, so it is sent as an event through this
      // window's SDK and its filters, not only kept as the console's
      // breadcrumb, once the SDK it waits for has loaded: with nothing to
      // draw, there is no paint to wait for. Note that it is captured here
      // rather than through main's Effect reporter, because providing a
      // reporter layer on this path put 90 to 130 KB gzipped on every
      // window's first load.
      sentry.reportBlankWindow(
        error instanceof Error ? error : new Error(String(error)),
        BLANK_WINDOW.FIRST_READ,
      );
      sentry.load();
      return;
    }
    draw(<RegistryContext.Provider value={rendererRegistry}>{surface}</RegistryContext.Provider>);
  })();
}
