/**
 * web-panel.ts -- the panel drawn in a jsdom tab as the web root draws it, on the fixture run's document, its history the tab's own and its address said as a link, and the browser's moves awaited as they land.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import "@repo/panel/testing/match-media";
import "@repo/panel/testing/resize-observer";
import { type AppStateSnapshot, RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import { type AppBridge, bridgeEntries } from "@repo/host/bridge";
import { initialAppState } from "@repo/host/client";
import { PUSH_METHOD } from "@repo/host/contract";
import { installAppBridge } from "@repo/panel/app-bridge";
import { installAppPlatform } from "@repo/panel/app-platform";
import { createPanelRouter, PanelRouterProvider } from "@repo/panel/panel-router";
import { rendererRegistry } from "@repo/panel/renderer-runtime";
import { loadTasksFixture } from "@repo/panel/tasks/tasks-fixture-loader";
import { onRegistry, readAppState } from "@repo/panel/testing/copy-feedback";
import { APP_SETTING_DEFAULTS, NO_EXPERIMENTS } from "@repo/settings";
import { QueryClient } from "@tanstack/react-query";
import { createBrowserHistory, type RouterHistory } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { withLoadLink } from "../../src/app/load-link";
import { webPlatform } from "../../src/app/web-platform";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

/** The tab's router history, made as the doors are installed, as the web root makes it. */
let tabHistory: RouterHistory | undefined;

/** Takes down every panel drawn so far, and stops the tab's history following the browser. */
export function unmountPanels(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  tabHistory?.destroy();
  tabHistory = undefined;
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
export async function settle(): Promise<void> {
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
      experiments: NO_EXPERIMENTS,
      accountRead: true,
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
  return {
    ...quiet,
    requestAppState: () => Promise.resolve(state),
  } as unknown as AppBridge;
}

/**
 * Installs the tab's doors as the web root does, the fixture's bridge
 * saying the tab's address as a link and the tab's own history, before the
 * test reads the panel's state (`drawPanel`) and draws it.
 */
export function installPanelDoors(profile: RunProfile = RUN_PROFILE.IDLE): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  tabHistory?.destroy();
  tabHistory = createBrowserHistory();
  installAppBridge(withLoadLink(fixtureBridge(profile), tabHistory));
  // Nothing counts a surface event here: no host stands behind the fixture.
  installAppPlatform(webPlatform({ recordSurfaceEvent: () => undefined }));
}

/** The panel drawn in the tab once its state is read, as the web root draws it. */
export async function drawPanel() {
  // A fixture run's window is drawn once its synthetic tasks have landed; they land before this one draws.
  await loadTasksFixture();
  // The document is in the test's client before the window draws, as the tab's root's `ensureQueryData` leaves it.
  await readAppState();
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  assert.ok(tabHistory !== undefined, "the tab's doors are installed");
  const router = createPanelRouter(tabHistory, new QueryClient());
  await act(async () =>
    root.render(onRegistry(rendererRegistry, createElement(PanelRouterProvider, { router }))),
  );
  await settle();
  const buttonOf = (label: string) =>
    [...element.querySelectorAll("button")].findLast(
      (one) => one.getAttribute("aria-label") === label,
    );
  const click = (label: string) => {
    const button = buttonOf(label);
    assert.ok(button !== undefined, `a ${label} button stands`);
    button.click();
  };
  return {
    shows: (label: string) => element.querySelector(`[aria-label="${label}"]`) !== null,
    offers: (label: string) => buttonOf(label) !== undefined,
    /** Presses `label` without waiting on what follows: for a press that moves the browser, inside `travel`, which waits for it to land. */
    click,
    press: async (label: string) => {
      await act(async () => click(label));
      await settle();
    },
  };
}
