/**
 * web-panel.ts -- the panel drawn in a jsdom tab as the web root draws it, on the fixture run's document, its history the tab's own and its address said as a link, and the browser's moves awaited as they land.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { type AppStateSnapshot, RUN_PROFILE, type RunProfile } from "@luke/host/app-state";
import { type AppBridge, bridgeEntries } from "@luke/host/bridge";
import { initialAppState } from "@luke/host/client";
import { PUSH_METHOD } from "@luke/host/contract";
import { App } from "@luke/panel/app";
import { installAppBridge } from "@luke/panel/app-bridge";
import { installAppPlatform } from "@luke/panel/app-platform";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { installShellBundles } from "@luke/panel/shell-bundles";
import { APP_SETTING_DEFAULTS, NO_EXPERIMENTS } from "@luke/settings";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { browserHistory } from "../../src/app/browser-history";
import { withLoadLink } from "../../src/app/load-link";
import { WEB_BUNDLES, webPlatform } from "../../src/app/web-platform";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

/** Takes down every panel drawn so far. */
export function unmountPanels(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

/** The tab standing at `address`, holding no saved step, as a page first loaded there does. */
export function openAt(address: string): void {
  window.history.replaceState(null, "", address);
}

/** The step the tab stands at, as the address bar shows it. */
export function addressBar(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/** Lands the browser on the entry `go` moves it to, once its `popstate` has fired and the page has heard it. */
export async function travel(go: () => void): Promise<void> {
  await act(async () => {
    const landed = once(window, "popstate");
    go();
    await landed;
  });
  await settle();
}

/** Lets every promise settled so far run its continuations, the panel's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The fixture's bridge, as the web root installs it: its document on the one read, every act refused, every other call quiet. */
export function fixtureBridge(profile: RunProfile): AppBridge {
  const state: AppStateSnapshot = {
    ...initialAppState(
      {
        launch: { profile, captureMode: false, fixtureMode: true },
        runMode: { requiresAccount: false, sendsNetwork: false },
        appVersion: "0.0.0",
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
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke"
        ? () => Promise.reject(new Error("The fixture does not act."))
        : () => undefined,
    ]),
  ]);
  // SAFETY: the map derives every method of the contract from BRIDGE by its kind's shape, as the web root's fixture does.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The manifest map proves the dynamically keyed object is the derived bridge.
  return {
    ...quiet,
    requestAppState: () => Promise.resolve(state),
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "fixture" }),
  } as unknown as AppBridge;
}

/**
 * Installs the tab's doors as the web root does, the fixture's bridge
 * saying the tab's address as a link and the tab's own history, before the
 * test reads the panel's state (`appStateFirstRead`) and draws it.
 */
export function installPanelDoors(profile: RunProfile = RUN_PROFILE.IDLE): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installAppBridge(withLoadLink(fixtureBridge(profile)));
  // Nothing counts a surface event here: no host stands behind the fixture.
  installAppPlatform(webPlatform({ recordSurfaceEvent: () => undefined }));
  installShellBundles(WEB_BUNDLES);
  installWindowHistory(browserHistory());
}

/** The panel drawn in the tab once its state is read, as the web root draws it. */
export async function drawPanel() {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(RegistryContext.Provider, { value: rendererRegistry }, createElement(App)),
    ),
  );
  await settle();
  const buttonOf = (label: string) =>
    [...element.querySelectorAll("button")].findLast(
      (one) => one.getAttribute("aria-label") === label,
    );
  return {
    shows: (label: string) => element.querySelector(`[aria-label="${label}"]`) !== null,
    offers: (label: string) => buttonOf(label) !== undefined,
    press: async (label: string) => {
      const button = buttonOf(label);
      assert.ok(button !== undefined, `a ${label} button stands`);
      await act(async () => button.click());
      await settle();
    },
  };
}
