// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { actPort, appBridge } from "@luke/panel/app-bridge";
import { appPlatform } from "@luke/panel/app-platform";
import { shellBundles } from "@luke/panel/shell-bundles";
import { afterEach, test, vi } from "vitest";
import { mountWebApp } from "../src/app/web-root";
import { fakeService } from "./support/fake-service";

/**
 * The web app's root closed: the panel taken down, and what the tab
 * installed for it taken down with it, so nothing it left behind answers a
 * later mount or follows the browser. Its own file, because the panel's
 * state read is the tab's once.
 */

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The `popstate` listeners the window holds, as listened and unlistened from here on. */
function popstateListeners(): Set<EventListenerOrEventListenerObject> {
  const held = new Set<EventListenerOrEventListenerObject>();
  const listen = window.addEventListener.bind(window);
  const unlisten = window.removeEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "popstate" && listener !== null) held.add(listener);
    listen(type, listener, options);
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
    if (type === "popstate" && listener !== null) held.delete(listener);
    unlisten(type, listener, options);
  });
  return held;
}

test("closing the app takes down the bridge, act port, platform, and bundles the tab installed for the panel, and its history stops following the browser", async () => {
  const listening = popstateListeners();
  const root = document.createElement("div");
  document.body.append(root);
  const app = await mountWebApp(root, { httpClient: fakeService({ signedIn: false }).layer });
  assert.ok(app !== undefined, "the host stands");
  assert.doesNotThrow(() => appBridge(), "the bridge stands while the app does");
  assert.ok(listening.size > 0, "the tab's history follows the browser while the app stands");

  await app.close();

  assert.throws(() => appBridge(), /No app bridge is installed/u);
  assert.throws(() => actPort(), /No act port is installed/u);
  assert.deepEqual([...listening], [], "nothing is left following the browser");
  assert.throws(() => appPlatform(), /No app platform is installed/u);
  assert.throws(() => shellBundles(), /No shell bundles are installed/u);
});
