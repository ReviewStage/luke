// fixture-main.tsx -- scratch: the real panel on the fixture run, no account, for design screenshots.
import "./app.css";
import "@luke/panel/testing/match-media";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
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
import { loadTasksFixture } from "@luke/panel/tasks/tasks-fixture-loader";
import { APP_SETTING_DEFAULTS, NO_EXPERIMENTS } from "@luke/settings";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { browserHistory } from "./browser-history";
import { withLoadLink } from "./load-link";
import { WEB_BUNDLES, webPlatform } from "./web-platform";

const params = new URLSearchParams(location.search);
const surface = params.get("surface") === "web" ? "web" : "desktop";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const scene = (params.get("scene") ?? RUN_PROFILE.TASKS) as RunProfile;
document.documentElement.setAttribute("data-luke-profile", surface);
document.documentElement.setAttribute("data-luke-theme", theme);

function bridge(profile: RunProfile): AppBridge {
  const state: AppStateSnapshot = {
    ...initialAppState(
      {
        launch: { profile, captureMode: false, fixtureMode: true },
        runMode: { requiresAccount: false, sendsNetwork: false },
        appVersion: "0.0.0",
        packaged: false,
        platform: surface === "web" ? "web" : "darwin",
      },
      false,
      [],
    ),
    settings: { stored: { ...APP_SETTING_DEFAULTS, theme }, status: { voiceAvailable: false }, experiments: NO_EXPERIMENTS },
    version: 1,
    window: { fullScreen: false },
  } as AppStateSnapshot;
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.reject(new Error("fixture")) : () => undefined,
    ]),
  ]);
  return { ...quiet, requestAppState: () => Promise.resolve(state) } as unknown as AppBridge;
}

installAppBridge(withLoadLink(bridge(scene)));
installAppPlatform(webPlatform({ recordSurfaceEvent: () => undefined }));
installShellBundles(WEB_BUNDLES);
installWindowHistory(browserHistory());
await loadTasksFixture();
const element = document.getElementById("root");
if (element)
  createRoot(element).render(
    createElement(RegistryContext.Provider, { value: rendererRegistry }, createElement(App)),
  );
