import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { LinkPlatform } from "@repo/features/link-open";
import type { DuplicateGatewayMethod, HostTag } from "@repo/host/effect";
import { installActPort, installAppBridge } from "@repo/panel/app-bridge";
import { installAppPlatform } from "@repo/panel/app-platform";
import { installShownFailureReporter } from "@repo/panel/failure-report";
import { LiveReadSubscription } from "@repo/panel/live-reads";
import { createPanelRouter, PanelRouterProvider } from "@repo/panel/panel-router";
import { QueryProvider, queryClient } from "@repo/panel/query-client";
import { rendererRegistry } from "@repo/panel/renderer-runtime";
import { AppStateSubscription, appStateQuery } from "@repo/panel/use-app-state";
import { ErrorBoundary, RELOAD_ROOM, ReloadState } from "@repo/ui/error-boundary";
import { createBrowserHistory } from "@tanstack/react-router";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { createRoot } from "react-dom/client";
import { browserLinkPlatform } from "../link-platform";
import { withLoadLink } from "./load-link";
import { browserLoadedFresh, handOffToMacApp } from "./mac-app-handoff";
import { WebAppearance } from "./web-appearance";
import { composeWeb, WebHostTag } from "./web-host";
import { startWebSentry, type WebSentryBuild, webSentryBuild } from "./web-sentry";

export interface WebAppOptions {
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>;
  readonly linkPlatform?: LinkPlatform;
  readonly openMacApp?: (appLink: string) => void;
  readonly sentry?: WebSentryBuild;
}

const TAB_FAILED = "This page could not be shown.";

const BOOT_FRAME = { SELECTOR: ".boot-frame", LIVE: "live", LEAVE: "boot-frame-leave" } as const;

function reloadTab(): void {
  location.reload();
}

function reportCaught(thrown: unknown): void {
  console.error("The tab's panel failed to render.", thrown);
  reportError(thrown);
}

function liftLoadingFrame(rootElement: HTMLElement): void {
  const frame = rootElement.querySelector<HTMLElement>(BOOT_FRAME.SELECTOR);
  if (frame?.dataset.bootMark !== BOOT_FRAME.LIVE) return;
  document.body.append(frame);
  frame.dispatchEvent(new Event(BOOT_FRAME.LEAVE));
}

export interface WebApp {
  readonly close: () => Promise<void>;
}

export async function mountWebApp(
  rootElement: HTMLElement,
  options: WebAppOptions = {},
): Promise<WebApp | undefined> {
  const loadedAt = location.href;
  const tabHistory = createBrowserHistory();
  const loadedFresh = browserLoadedFresh(tabHistory.location);
  const linkPlatform = options.linkPlatform ?? browserLinkPlatform();
  const sentry = startWebSentry(options.sentry ?? webSentryBuild());
  const httpClient = options.httpClient ?? FetchHttpClient.layer;
  let runtime: ManagedRuntime.ManagedRuntime<WebHostTag | HostTag, DuplicateGatewayMethod>;
  const fork = (effect: Effect.Effect<void>): void => {
    runtime.runFork(Effect.withErrorReporting(effect, { defectsOnly: true }));
  };
  runtime = ManagedRuntime.make(
    Layer.provideMerge(composeWeb({ httpClient, fork, linkPlatform }), sentry.errorReporting),
  );
  const installed: (() => void)[] = [() => tabHistory.destroy()];
  const uninstall = () => {
    for (const undo of installed.splice(0).reverse()) undo();
  };
  try {
    const web = await runtime.runPromise(WebHostTag);
    installed.push(installAppBridge(withLoadLink(web.bridge, tabHistory)));
    installed.push(installActPort(web.actPort, web.actPortClient));
    installed.push(installAppPlatform(web.platform));
    installed.push(installShownFailureReporter(sentry.reportShownFailure));
    await queryClient.ensureQueryData(appStateQuery);
  } catch (error) {
    console.error(
      "The tab's host could not stand or its state be read; its panel is not drawn.",
      error,
    );
    sentry.reportBlankTab(error instanceof Error ? error : new Error(String(error)));
    uninstall();
    rootElement.replaceChildren();
    await runtime.dispose();
    createRoot(rootElement).render(
      <ReloadState failure={TAB_FAILED} room={RELOAD_ROOM.WINDOW} onReload={reloadTab} />,
    );
    return undefined;
  }
  liftLoadingFrame(rootElement);
  const router = createPanelRouter(tabHistory, queryClient);
  const root = createRoot(rootElement, { onCaughtError: reportCaught });
  root.render(
    <ErrorBoundary failure={TAB_FAILED} room={RELOAD_ROOM.WINDOW} onReload={reloadTab}>
      <RegistryContext.Provider value={rendererRegistry}>
        <QueryProvider>
          <AppStateSubscription />
          <LiveReadSubscription />
          <WebAppearance />
          <PanelRouterProvider router={router} />
        </QueryProvider>
      </RegistryContext.Provider>
    </ErrorBoundary>,
  );
  runtime.runFork(
    Effect.provide(
      handOffToMacApp(
        {
          address: loadedAt,
          fresh: loadedFresh,
          platform: linkPlatform,
          open: options.openMacApp ?? ((appLink) => location.assign(appLink)),
        },
        location.origin,
      ),
      httpClient,
    ),
  );
  return {
    close: async () => {
      root.unmount();
      uninstall();
      await runtime.dispose();
    },
  };
}
