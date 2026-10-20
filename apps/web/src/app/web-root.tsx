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
 * window root does.
 *
 * Until the panel draws, the tab shows the shell's frame app.html stands in
 * the root element, which the root's first render replaces; a tab that can
 * draw nothing takes the frame down, so it is never left looking as though
 * the panel were still coming. What the next load's frame needs to know of
 * this one is kept as the panel draws (`first-frame-hint.tsx`).
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { LinkPlatform } from "@luke/features/link-open";
import type { DuplicateGatewayMethod, HostTag } from "@luke/host/effect";
import { App } from "@luke/panel/app";
import { installActPort, installAppBridge } from "@luke/panel/app-bridge";
import { installAppPlatform } from "@luke/panel/app-platform";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { installShellBundles } from "@luke/panel/shell-bundles";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import type { HistoryAdapter } from "@luke/ui/history-adapter";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { createRoot } from "react-dom/client";
import { type BrowserHistory, browserHistory } from "./browser-history";
import { FirstFrameHint } from "./first-frame-hint";
import { withLoadLink } from "./load-link";
import { browserLinkPlatform, browserLoadedFresh, handOffToMacApp } from "./mac-app-handoff";
import { WebAppearance } from "./web-appearance";
import { composeWeb, WebHostTag } from "./web-host";
import { WEB_BUNDLES } from "./web-platform";
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

/** The app as drawn: closing it takes the panel down and drains the host. */
export interface WebApp {
  readonly close: () => Promise<void>;
}

/** Installs the tab's own history as the panel's, answering how to take it down and stop it following the browser. */
function installTabHistory<State>(
  install: (history: HistoryAdapter<State>) => () => void,
  history: BrowserHistory<State>,
): () => void {
  const uninstall = install(history);
  return () => {
    uninstall();
    history.dispose();
  };
}

/**
 * Composes the host in the tab, installs its doors, and draws the panel into
 * the element given once its document has been read, in place of whatever
 * frame the element held. A tab whose host cannot stand, or whose document
 * cannot be read, empties the element and draws nothing, as a desktop window
 * does, and answers nothing to close.
 */
export async function mountWebApp(
  rootElement: HTMLElement,
  options: WebAppOptions = {},
): Promise<WebApp | undefined> {
  // The address the tab loaded at, and whether it came there fresh, read before the panel's history writes its own steps into it.
  const loadedAt = location.href;
  const loadedFresh = browserLoadedFresh();
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
  const installed: (() => void)[] = [];
  const uninstall = () => {
    for (const undo of installed.splice(0).reverse()) undo();
  };
  try {
    const web = await runtime.runPromise(WebHostTag);
    // The address the tab was opened at is said once, as the link it is.
    installed.push(installAppBridge(withLoadLink(web.bridge)));
    installed.push(installActPort(web.actPort, web.actPortClient));
    installed.push(installAppPlatform(web.platform));
    installed.push(installShellBundles(WEB_BUNDLES));
    // The panel's back and forward are the browser's own, each step in the tab's address.
    installed.push(installTabHistory(installWindowHistory, browserHistory()));
    await runtime.runPromise(appStateFirstRead);
  } catch (error) {
    console.error("The tab's host could not stand or its state be read; nothing is drawn.", error);
    // A blank tab is a failure, so it is sent as an event, not only kept as the console's breadcrumb.
    sentry.reportBlankTab(error instanceof Error ? error : new Error(String(error)));
    uninstall();
    rootElement.replaceChildren();
    await runtime.dispose();
    return undefined;
  }
  const root = createRoot(rootElement);
  root.render(
    <RegistryContext.Provider value={rendererRegistry}>
      <WebAppearance />
      <FirstFrameHint />
      <App />
    </RegistryContext.Provider>,
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
