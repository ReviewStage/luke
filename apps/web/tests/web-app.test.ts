// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/resize-observer";
import { act } from "react";
import { test } from "vitest";
import { mountWebApp } from "../src/app/web-root";

/**
 * The web app's root on its fixture bridge: the panel drawn in a tab from the
 * fixture run's document, before any host runs there.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

test("the web root draws the panel's Home over the fixture's tasks", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = document.createElement("div");
  document.body.append(root);

  await act(() => mountWebApp(root));

  const home = root.querySelector('section[aria-label="Home"]');
  assert.ok(home !== null, "the panel opens on Home");
  assert.match(root.textContent ?? "", /Ada Lovelace/);
});
