import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { ACT_PORT, type PreloadBridge } from "@repo/host/bridge";
import { actPort, installActPort, installAppBridge, openPushStream } from "@repo/panel/app-bridge";
import { installAppPlatform } from "@repo/panel/app-platform";
import { installShownFailureReporter } from "@repo/panel/failure-report";
import { LiveReadSubscription } from "@repo/panel/live-reads";
import {
  endWindowSpanOnFirstDraw,
  installPanelSpanRecorder,
  leaveWindowSpan,
  markWindowStart,
  PANEL_SPAN,
} from "@repo/panel/panel-spans";
import { QueryProvider, queryClient } from "@repo/panel/query-client";
import { rendererRegistry } from "@repo/panel/renderer-runtime";
import { AppStateSubscription, appStateQuery } from "@repo/panel/use-app-state";
import { RELOAD_ROOM, ReloadState } from "@repo/ui/error-boundary";
import type { ReactNode } from "react";
import { DESKTOP_PLATFORM } from "./desktop-platform";
import { BLANK_WINDOW, startDesktopSentry } from "./desktop-sentry";
import { createReportingRoot, reloadWindow, WINDOW_FAILED } from "./desktop-sentry-root";

export interface WindowTiming {
  readonly timesStart: boolean;
}

export function mountWindow(
  surface: ReactNode,
  timing: WindowTiming = { timesStart: false },
): void {
  if (timing.timesStart) markWindowStart();
  const preloadWindow: Window & { readonly appBridge?: PreloadBridge } = window;
  if (preloadWindow.appBridge === undefined) throw new Error("The preload's bridge is missing");
  const actPortChannel = new MessageChannel();
  window.postMessage(ACT_PORT.REQUEST, "*", [actPortChannel.port2]);
  installActPort(actPortChannel.port1);
  const pushes = openPushStream(actPort());
  installAppBridge({ ...preloadWindow.appBridge, ...pushes.listeners });
  installAppPlatform(DESKTOP_PLATFORM);

  const sentry = startDesktopSentry();
  installPanelSpanRecorder(sentry.recordSpan);
  installShownFailureReporter(sentry.reportShownFailure);

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Renderer root element is missing");
  const draw = createReportingRoot(rootElement, {
    ...sentry,
    reportBlankWindow: (error, why) => {
      leaveWindowSpan(PANEL_SPAN.WINDOW_FIRST_PAINT);
      sentry.reportBlankWindow(error, why);
    },
  });

  void (async () => {
    try {
      await pushes.opened;
      await queryClient.ensureQueryData(appStateQuery);
    } catch (error) {
      console.error("The window's state could not be read; its surface is not drawn.", error);
      sentry.reportBlankWindow(
        error instanceof Error ? error : new Error(String(error)),
        BLANK_WINDOW.FIRST_READ,
      );
      sentry.load();
      draw(
        <ReloadState failure={WINDOW_FAILED} room={RELOAD_ROOM.WINDOW} onReload={reloadWindow} />,
      );
      return;
    }
    endWindowSpanOnFirstDraw(rootElement, PANEL_SPAN.WINDOW_FIRST_PAINT);
    draw(
      <RegistryContext.Provider value={rendererRegistry}>
        <QueryProvider>
          <AppStateSubscription />
          <LiveReadSubscription />
          {surface}
        </QueryProvider>
      </RegistryContext.Provider>,
    );
  })();
}
