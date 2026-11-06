/**
 * web-root.tsx -- what the web app's entry runs to draw the panel in a tab: the host composed and started in the tab, its bridge, platform, and bundles installed, the first read, and the one root.
 *
 * The host is the shared one (`web-host.ts`), signed in by the service's own
 * cookie session on this origin. This module is a runtime edge
 * (`tools/anti-slop/effect-edges.json`), as the desktop's `window-root.tsx`
 * is: it builds the tab's one runtime over the host's layer, which every act
 * runs on, and runs the panel's first read. The tab is drawn in the
 * account's Theme setting beside the panel (`web-appearance.tsx`). It starts
 * the tab's Sentry first (`web-sentry.ts`), where the build carries a DSN,
 * stands the runtime on its reporter, as the desktop's main stands its own,
 * and reports through it a tab that could draw nothing, as the desktop's
 * window root does. The panel draws under the tab's router
 * (`@repo/panel/panel-router`), over the router's history of the tab
 * (`createBrowserHistory`), so the address bar and the browser's Back and
 * Forward follow the panel's own, and its routes are handed the window's
 * Query client, as the desktop's window draws it.
 *
 * Until the panel draws, the tab shows the loading frame app.html stands in
 * the root element, which the root's first render replaces; where the frame
 * draws its mark as moving dots (`public/boot-mark.js`), it is lifted out of
 * the root over the panel instead and told to leave, so its dots and ground
 * fade out together to the panel. A tab that can draw nothing takes the frame down and
 * says so with Reload in its place, so it is never left looking as though the
 * panel were still coming, nor blank. The panel stands in an error boundary
 * that does the same for a render that throws.
 */

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

/** What a caller other than the page's entry hands the tab: a test's client in place of the network. */
export interface WebAppOptions {
  /** The client every service call goes out on; the tab's same-origin fetch where none is given. */
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>;
  /** The platform the tab says it runs on, which decides whether the Mac app is offered and handed links; the browser's own word where none is given. */
  readonly linkPlatform?: LinkPlatform;
  /** How the loaded link is handed to the Mac app; a navigation to the desktop's scheme where none is given. */
  readonly openMacApp?: (appLink: string) => void;
  /** Where the tab reports to Sentry; what the build carries where none is given. */
  readonly sentry?: WebSentryBuild;
}

/** What a tab whose panel could not be drawn says over its Reload. */
const TAB_FAILED = "This page could not be shown.";

/** The loading frame as app.html and `public/boot-mark.js` name it: the frame, the mark it says is drawing, and the event that sends it away. */
const BOOT_FRAME = { SELECTOR: ".boot-frame", LIVE: "live", LEAVE: "boot-frame-leave" } as const;

/** Reload's press for the tab: the page read again from the start, its host, its first read, and every chunk among it. */
function reloadTab(): void {
  location.reload();
}

/**
 * Hands a failure an error boundary caught to the tab's own error event, as
 * React does with one no boundary caught, so Sentry's SDK hears it there.
 */
function reportCaught(thrown: unknown): void {
  console.error("The tab's panel failed to render.", thrown);
  reportError(thrown);
}

/**
 * Lifts the loading frame out of `rootElement`, over the panel about to draw
 * there, and sends it away, where its mark is drawing as moving dots; a frame
 * with no such mark is left for the root's first render to replace. Note that
 * the frame takes itself down once it has faded.
 */
function liftLoadingFrame(rootElement: HTMLElement): void {
  const frame = rootElement.querySelector<HTMLElement>(BOOT_FRAME.SELECTOR);
  if (frame?.dataset.bootMark !== BOOT_FRAME.LIVE) return;
  document.body.append(frame);
  frame.dispatchEvent(new Event(BOOT_FRAME.LEAVE));
}

/** The app as drawn: closing it takes the panel down and drains the host. */
export interface WebApp {
  readonly close: () => Promise<void>;
}

/**
 * Composes the host in the tab, installs its doors, and draws the panel into
 * the element given once its document has been read, in place of whatever
 * frame the element held. A tab whose host cannot stand, or whose document
 * cannot be read, draws that failure with Reload in place of the frame, as a
 * desktop window does, and answers nothing to close.
 */
export async function mountWebApp(
  rootElement: HTMLElement,
  options: WebAppOptions = {},
): Promise<WebApp | undefined> {
  // The address the tab loaded at, and whether it came there fresh, read before the panel's history writes its own steps into it.
  const loadedAt = location.href;
  // The panel's back and forward are the browser's own, each step in the tab's address, through the router's history of the tab.
  const tabHistory = createBrowserHistory();
  const loadedFresh = browserLoadedFresh(tabHistory.location);
  const linkPlatform = options.linkPlatform ?? browserLinkPlatform();
  // Never awaited: the SDK is a chunk of its own, and what is reported before it lands waits for it.
  const sentry = startWebSentry(options.sentry ?? webSentryBuild());
  const httpClient = options.httpClient ?? FetchHttpClient.layer;
  // Note that a count is forked only once the host stands, by which time the runtime is set.
  let runtime: ManagedRuntime.ManagedRuntime<WebHostTag | HostTag, DuplicateGatewayMethod>;
  // A defect in a count is reported, as the desktop's acts are.
  const fork = (effect: Effect.Effect<void>): void => {
    runtime.runFork(Effect.withErrorReporting(effect, { defectsOnly: true }));
  };
  // Sentry's reporter stands beneath the host, so every fiber it forks and every act reports through it.
  runtime = ManagedRuntime.make(
    Layer.provideMerge(composeWeb({ httpClient, fork, linkPlatform }), sentry.errorReporting),
  );
  // What the tab installed, taken down again in the reverse order as it closes.
  const installed: (() => void)[] = [() => tabHistory.destroy()];
  const uninstall = () => {
    for (const undo of installed.splice(0).reverse()) undo();
  };
  try {
    const web = await runtime.runPromise(WebHostTag);
    // The address the tab was opened at is said once, as the link it is.
    installed.push(installAppBridge(withLoadLink(web.bridge, tabHistory)));
    installed.push(installActPort(web.actPort, web.actPortClient));
    installed.push(installAppPlatform(web.platform));
    // Every failure the panel shows is reported through the tab's Sentry.
    installed.push(installShownFailureReporter(sentry.reportShownFailure, queryClient));
    // The document is read into the window's Query client before anything is drawn over it, so
    // no reader draws a first frame without it.
    await queryClient.ensureQueryData(appStateQuery);
  } catch (error) {
    console.error(
      "The tab's host could not stand or its state be read; its panel is not drawn.",
      error,
    );
    // A tab with no panel is a failure, so it is sent as an event, not only kept as the console's breadcrumb.
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
  // The account's choice of the Mac app is read after the first paint, once per fresh load, and never awaited.
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
