/**
 * window-root.tsx -- what every window's entry runs to draw: tracing, the one root, and the surface it mounts once the window's document reads.
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
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AppBridge } from "#shared/bridge";
import {
  eventWithoutAccessTokens,
  transactionWithoutAccessTokens,
  withoutAccessTokens,
} from "#shared/sentry-breadcrumbs";
import { installAppBridge } from "./app-bridge";
import { installAppPlatform } from "./app-platform";
import { DESKTOP_PLATFORM } from "./desktop-platform";
import { rendererRegistry } from "./renderer-runtime";
import { appStateFirstRead } from "./use-app-state";

/**
 * Installs the window's bridge and platform, starts its tracing, and draws `surface` into
 * its root once the window's document has been read. A window whose document
 * cannot be read mounts nothing: a fallback would protect nothing.
 */
export function mountWindow(surface: ReactNode): void {
  // The desktop's bridge is the one the preload exposed as `window.luke`, and
  // this is the one place that global is read: everything else reaches main
  // through `appBridge()`, which reads what is installed here before anything
  // below subscribes or draws. What only the shell can do is answered beside
  // it, through `appPlatform()`, by the desktop's own acts and events.
  const preloadWindow: Window & { readonly luke?: AppBridge } = window;
  if (preloadWindow.luke === undefined) throw new Error("The preload's bridge is missing");
  installAppBridge(preloadWindow.luke);
  installAppPlatform(DESKTOP_PLATFORM);

  // Every window's tracing, as Sentry's Electron guide sets up a renderer;
  // the DSN, release, and environment are main's, which every renderer event
  // goes through.
  Sentry.init({
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    beforeSendTransaction: transactionWithoutAccessTokens,
  });

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Renderer root element is missing");
  const root = createRoot(rootElement);

  void (async () => {
    try {
      await Effect.runPromise(appStateFirstRead);
    } catch (error) {
      console.error("The window's state could not be read; nothing is drawn.", error);
      return;
    }
    root.render(
      <RegistryContext.Provider value={rendererRegistry}>{surface}</RegistryContext.Provider>,
    );
  })();
}
