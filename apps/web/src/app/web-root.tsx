/**
 * web-root.tsx -- what the web app's entry runs to draw the panel in a tab: the host composed and started in the tab, its bridge, platform, and bundles installed, the first read, and the one root.
 *
 * The host is the shared one (`web-host.ts`), signed in by the service's own
 * cookie session on this origin. This module is a runtime edge
 * (`tools/anti-slop/effect-edges.json`), as the desktop's `window-root.tsx`
 * is: it builds the tab's one runtime over the host's layer, which every act
 * runs on, and runs the panel's first read.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { DuplicateGatewayMethod, HostTag } from "@luke/host/effect";
import { App } from "@luke/panel/app";
import { installActPort, installAppBridge } from "@luke/panel/app-bridge";
import { installAppPlatform } from "@luke/panel/app-platform";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { installShellBundles } from "@luke/panel/shell-bundles";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { Effect, type Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { createRoot } from "react-dom/client";
import { browserHistory } from "./browser-history";
import { withLoadLink } from "./load-link";
import { composeWeb, WebHostTag } from "./web-host";
import { WEB_BUNDLES } from "./web-platform";

/** What a caller other than the page's entry hands the tab: a test's client in place of the network. */
export interface WebAppOptions {
  /** The client every service call goes out on; the tab's same-origin fetch where none is given. */
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>;
}

/** The app as drawn: closing it takes the panel down and drains the host. */
export interface WebApp {
  readonly close: () => Promise<void>;
}

/**
 * Composes the host in the tab, installs its doors, and draws the panel into
 * the element given once its document has been read. A tab whose host cannot
 * stand, or whose document cannot be read, draws nothing, as a desktop window
 * does, and answers nothing to close.
 */
export async function mountWebApp(
  rootElement: HTMLElement,
  options: WebAppOptions = {},
): Promise<WebApp | undefined> {
  // Note that an act runs only once the host stands, by which time the runtime is set.
  let runtime: ManagedRuntime.ManagedRuntime<WebHostTag | HostTag, DuplicateGatewayMethod>;
  const run = <A,>(effect: Effect.Effect<A>): Promise<A> => runtime.runPromise(effect);
  runtime = ManagedRuntime.make(
    composeWeb({ httpClient: options.httpClient ?? FetchHttpClient.layer, run }),
  );
  try {
    const web = await runtime.runPromise(WebHostTag);
    // The address the tab was opened at is said once, as the link it is.
    installAppBridge(withLoadLink(web.bridge));
    installActPort(web.actPort);
    installAppPlatform(web.platform);
    installShellBundles(WEB_BUNDLES);
    // The panel's back and forward are the browser's own, each step in the tab's address.
    installWindowHistory(browserHistory());
    await Effect.runPromise(appStateFirstRead);
  } catch (error) {
    console.error("The tab's host could not stand or its state be read; nothing is drawn.", error);
    await runtime.dispose();
    return undefined;
  }
  const root = createRoot(rootElement);
  root.render(
    <RegistryContext.Provider value={rendererRegistry}>
      <App />
    </RegistryContext.Provider>,
  );
  return {
    close: async () => {
      root.unmount();
      await runtime.dispose();
    },
  };
}
