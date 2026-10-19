/**
 * web-root.tsx -- what the web app's entry runs to draw the panel in a tab: the bridge, the platform, and the bundles installed, the first read, and the one root.
 *
 * The bridge here is a fixture: it hands the panel a signed-out fixture run's
 * document, which the panel draws its own synthetic tasks over
 * (`@luke/panel`'s `tasks/tasks-fixture.ts`), and refuses every act, so the
 * panel builds and draws in the web app before any host runs in the tab. The
 * host in the tab replaces it. This module is a runtime edge
 * (`tools/anti-slop/effect-edges.json`) where it runs the first read, as the
 * desktop's `window-root.tsx` is.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { type AppStateSnapshot, RUN_PROFILE } from "@luke/host/app-state";
import { type AppBridge, bridgeEntries } from "@luke/host/bridge";
import { initialAppState } from "@luke/host/client";
import { type ActPortClient, actContract } from "@luke/host/contract";
import { App } from "@luke/panel/app";
import { installActPortClient, installAppBridge } from "@luke/panel/app-bridge";
import { installAppPlatform } from "@luke/panel/app-platform";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { installShellBundles } from "@luke/panel/shell-bundles";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { APP_SETTING_DEFAULTS, NO_EXPERIMENTS } from "@luke/settings";
import { memoryHistory } from "@luke/ui/history-adapter";
import { Effect } from "effect";
import { createRoot } from "react-dom/client";
import packageJson from "../../package.json";
import { WEB_BUNDLES, WEB_PLATFORM } from "./web-platform";

/** Why the fixture refuses every act. */
const FIXTURE_REFUSAL = "The web app does not act yet.";

/**
 * The document the fixture hands the panel: a signed-out fixture run on no
 * platform feature, every setting at its default, never patched.
 */
const FIXTURE_STATE: AppStateSnapshot = {
  ...initialAppState(
    {
      launch: { profile: RUN_PROFILE.IDLE, captureMode: false, fixtureMode: true },
      runMode: { requiresAccount: false, sendsNetwork: false },
      appVersion: packageJson.version,
      packaged: false,
      platform: "web",
    },
    false,
    [],
  ),
  settings: {
    stored: APP_SETTING_DEFAULTS,
    status: { voiceAvailable: false },
    experiments: NO_EXPERIMENTS,
  },
  version: 1,
  window: { fullScreen: false },
};

/**
 * The fixture bridge: the document above on the one read, every act refused,
 * any other invoke rejected, every send dropped, and every subscription
 * silent, so the table stays total as the bridge contract grows.
 */
function fixtureBridge(): AppBridge {
  const quiet = Object.fromEntries(
    bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "subscribe"
        ? () => () => undefined
        : entry.kind === "invoke"
          ? () => Promise.reject(new Error(FIXTURE_REFUSAL))
          : () => undefined,
    ]),
  );
  const answering: Pick<AppBridge, "requestAppState" | "act"> = {
    requestAppState: () => Promise.resolve(FIXTURE_STATE),
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: FIXTURE_REFUSAL }),
  };
  // SAFETY: the map derives every method of the contract from BRIDGE by its kind's shape, and the two the panel reads are typed above.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The manifest map proves the dynamically keyed object is the derived bridge, as the preload's does.
  return { ...quiet, ...answering } as unknown as AppBridge;
}

/**
 * The fixture act port: every kind it answers refused in the same words as
 * the bridge's acts, so a press reads the fixture's refusal whichever door
 * its kind rides.
 */
function fixtureActPort(): ActPortClient {
  const refused = () => Promise.reject(new Error(FIXTURE_REFUSAL));
  // SAFETY: every procedure of the contract, keyed by its kind, answers the one refusal, which is all a caller of any of them handles.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The contract's own keys prove the dynamically keyed object is the whole client, as the fixture bridge's map does.
  return Object.fromEntries(
    Object.keys(actContract).map((kind) => [kind, refused]),
  ) as unknown as ActPortClient;
}

/**
 * Installs the tab's doors and draws the panel into the element given once
 * its document has been read. A tab whose document cannot be read draws
 * nothing, as a desktop window does.
 */
export async function mountWebApp(rootElement: HTMLElement): Promise<void> {
  installAppBridge(fixtureBridge());
  installActPortClient(fixtureActPort());
  installAppPlatform(WEB_PLATFORM);
  installShellBundles(WEB_BUNDLES);
  // The panel's back and forward live in memory until the tab's address carries them.
  installWindowHistory(memoryHistory());
  try {
    await Effect.runPromise(appStateFirstRead);
  } catch (error) {
    console.error("The tab's state could not be read; nothing is drawn.", error);
    return;
  }
  createRoot(rootElement).render(
    <RegistryContext.Provider value={rendererRegistry}>
      <App />
    </RegistryContext.Provider>,
  );
}
