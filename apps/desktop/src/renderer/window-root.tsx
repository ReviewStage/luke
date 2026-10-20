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
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@luke/features/sentry-breadcrumbs";
import { SENTRY_TRACES_SAMPLE_RATE, sentryTracesRequest } from "@luke/features/sentry-tracing";
import { ACT_PORT, type PreloadBridge } from "@luke/host/bridge";
import { actPort, installActPort, installAppBridge, openPushStream } from "@luke/panel/app-bridge";
import { installAppPlatform } from "@luke/panel/app-platform";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DESKTOP_PLATFORM } from "./desktop-platform";

/**
 * Installs the window's bridge and platform, starts its tracing, and draws
 * `surface` into its root once the window's document has been read. A window
 * whose document cannot be read mounts nothing: a fallback would protect
 * nothing.
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

  // Every window's tracing, as Sentry's Electron guide sets up a renderer;
  // the DSN, release, and environment are main's, which every renderer event
  // goes through. Its reports reach main as requests of their own, which
  // are never traced (`sentryTracesRequest`).
  Sentry.init({
    integrations: [
      Sentry.browserTracingIntegration({ shouldCreateSpanForRequest: sentryTracesRequest }),
    ],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: Sentry.withStreamedSpan(spanWithoutAccessTokens),
  });

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Renderer root element is missing");
  const root = createRoot(rootElement);

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
      // breadcrumb. Note that it is captured here rather than through main's
      // Effect reporter, because providing a reporter layer on this path put
      // 90 to 130 KB gzipped on every window's first load.
      Sentry.captureException(error, {
        mechanism: { type: "auto.electron.renderer.first_read", handled: false },
      });
      return;
    }
    root.render(
      <RegistryContext.Provider value={rendererRegistry}>{surface}</RegistryContext.Provider>,
    );
  })();
}
