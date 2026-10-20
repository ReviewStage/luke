// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { appBridge } from "@luke/panel/app-bridge";
import { appPlatform } from "@luke/panel/app-platform";
import { shellBundles } from "@luke/panel/shell-bundles";
import { afterEach, test } from "vitest";
import { mountWebApp } from "../src/app/web-root";
import { fakeService } from "./support/fake-service";

/**
 * The web app's root closed: the panel taken down, and what the tab
 * installed for it taken down with it, so nothing it left behind answers a
 * later mount or follows the browser. Its own file, because the panel's
 * state read is the tab's once.
 */

afterEach(() => {
  localStorage.clear();
});

test("closing the app takes down the bridge, platform, and bundles the tab installed for the panel", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const app = await mountWebApp(root, { httpClient: fakeService({ signedIn: false }).layer });
  assert.ok(app !== undefined, "the host stands");
  assert.doesNotThrow(() => appBridge(), "the bridge stands while the app does");

  await app.close();

  assert.throws(() => appBridge(), /No app bridge is installed/u);
  assert.throws(() => appPlatform(), /No app platform is installed/u);
  assert.throws(() => shellBundles(), /No shell bundles are installed/u);
});
