// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { HarnessMark } from "./harness-marks.js";
import { fakeAppPlatform } from "./testing/app-platform.js";

/**
 * The panel's static files resolve from the asset base its shell names, not
 * from the document's own address, which on the web is a route such as
 * `/<workspace>/plan/<id>` rather than the folder the files are served from.
 */

const BASE = "https://luke.example/assets/panel/";

test("Excalidraw's fonts and the Codex mark both resolve from the asset base the shell names", async () => {
  window.history.replaceState(null, "", "/acme/plan/0b805267");
  fakeAppPlatform({ assetBase: () => BASE });

  await import("./whiteboard/asset-path.js");
  assert.equal(window.EXCALIDRAW_ASSET_PATH, BASE);

  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    createElement(HarnessMark, { provider: MODEL_PROVIDER.OPENAI }),
  );
  const mark = page.querySelector("img");
  assert.equal(mark?.getAttribute("src"), `${BASE}marks/codex-16.png`);
  assert.equal(
    mark?.getAttribute("srcset"),
    `${BASE}marks/codex-16.png 1x, ${BASE}marks/codex-32.png 2x, ${BASE}marks/codex-48.png 3x`,
  );
});
