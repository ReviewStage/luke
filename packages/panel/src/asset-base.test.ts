// @vitest-environment jsdom

import assert from "node:assert/strict";
import { test } from "vitest";
import { fakeAppPlatform } from "./testing/app-platform.js";

/**
 * The panel's static files resolve from the asset base its shell names, not
 * from the document's own address, which on the web is a route such as
 * `/<workspace>/plan/<id>` rather than the folder the files are served from.
 */

const BASE = "https://luke.example/assets/panel/";

test("Excalidraw's fonts resolve from the asset base the shell names", async () => {
  window.history.replaceState(null, "", "/acme/plan/0b805267");
  fakeAppPlatform({ assetBase: () => BASE });

  await import("./whiteboard/asset-path.js");
  assert.equal(window.EXCALIDRAW_ASSET_PATH, BASE);
});
