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
import {
  endWindowSpanOnFirstDraw,
  installPanelSpanRecorder,
  markWindowStart,
  PANEL_SPAN,
} from "@luke/panel/panel-spans";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { ReloadState } from "@luke/ui/error-boundary";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { DESKTOP_PLATFORM } from "./desktop-platform";
import { BLANK_WINDOW, type DesktopSentryOptions, startDesktopSentry } from "./desktop-sentry";
import { createReportingRoot, reloadWindow, WINDOW_FAILED } from "./desktop-sentry-root";

/** What a window times of its own start. */
export interface WindowTiming {
  /**
   * Whether the window times its root starting to its first state drawn and
   * to its first task list read: the panel's alone, the one window a person
   * waits on, so the other windows' starts never mix with its.
   */
  readonly timesStart: boolean;
}

/**
 * Installs the window's bridge and platform, draws `surface` into its root
 * once the window's document has been read, and then starts its tracing. A
 * window whose document cannot be read draws that failure with Reload in
 * place of the surface, rather than stand blank. What its SDK watches
 * beyond every window's is `sentry`'s to say: the panel's entry asks for
 * its freezes to be reported, and, by `timing`, for its start to be timed.
 */
export function mountWindow(
  surface: ReactNode,
  sentryOptions: DesktopSentryOptions = { reportsFreezes: false },
  timing: WindowTiming = { timesStart: false },
): void {
  // The window's start, which its first paint and first usable screen are timed from.
  if (timing.timesStart) markWindowStart();
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
  const sentry = startDesktopSentry(sentryOptions);
  // What the panel times, recorded through the same SDK once it stands.
  installPanelSpanRecorder(sentry.recordSpan);

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
      console.error("The window's state could not be read; its surface is not drawn.", error);
      // A window with no state is a failure, so it is sent as an event through
      // this window's SDK and its filters, not only kept as the console's
      // breadcrumb, once the SDK it waits for has loaded: with no surface to
      // draw, there is no paint to wait for. Note that it is captured here
      // rather than through main's Effect reporter, because providing a
      // reporter layer on this path put 90 to 130 KB gzipped on every
      // window's first load.
      sentry.reportBlankWindow(
        error instanceof Error ? error : new Error(String(error)),
        BLANK_WINDOW.FIRST_READ,
      );
      sentry.load();
      draw(<ReloadState failure={WINDOW_FAILED} onReload={reloadWindow} />);
      return;
    }
    endWindowSpanOnFirstDraw(rootElement, PANEL_SPAN.WINDOW_FIRST_PAINT);
    draw(<RegistryContext.Provider value={rendererRegistry}>{surface}</RegistryContext.Provider>);
  })();
}
