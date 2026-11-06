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
import { rendererPromise, rendererRegistry } from "@repo/panel/renderer-runtime";
import { loadTasksFixture } from "@repo/panel/tasks/tasks-fixture-loader";
import { onRegistry, writeAppState } from "@repo/panel/testing/copy-feedback";
import { appStateFirstRead } from "@repo/panel/use-app-state";
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

let tabHistory: RouterHistory | undefined;

export function unmountPanels(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  tabHistory?.destroy();
  tabHistory = undefined;
  document.body.innerHTML = "";
}

export function openAt(address: string): void {
  window.history.replaceState(null, "", address);
}

export function addressBar(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

export async function travel(go: () => void): Promise<void> {
  await act(async () => {
    const landed = once(window, "popstate");
    go();
    await landed;
  });
  await settle();
}

export async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

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
  return {
    ...quiet,
    requestAppState: () => Promise.resolve(state),
  } as unknown as AppBridge;
}

export function installPanelDoors(profile: RunProfile = RUN_PROFILE.IDLE): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  tabHistory?.destroy();
  tabHistory = createBrowserHistory();
  installAppBridge(withLoadLink(fixtureBridge(profile), tabHistory));
  installAppPlatform(webPlatform({ recordSurfaceEvent: () => undefined }));
}

export async function drawPanel() {
  await loadTasksFixture();
  writeAppState(await rendererPromise(appStateFirstRead));
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
    click,
    press: async (label: string) => {
      await act(async () => click(label));
      await settle();
    },
  };
}
