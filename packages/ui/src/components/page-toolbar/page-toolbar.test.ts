// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { PageToolbar } from "../../index.js";

/**
 * page-toolbar.test.ts -- a page's strip is a banner holding what leads it,
 * then its heading, then its actions, in that order, and draws only the
 * parts it is given.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Draws a strip with the parts given and answers its banner. */
function draw(props: Parameters<typeof PageToolbar>[0]): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(PageToolbar, props)));
  const banner = container.querySelector("header") ?? assert.fail("no strip");
  return banner;
}

test("the strip reads its lead, then its heading, then its actions", () => {
  const banner = draw({
    lead: createElement("span", null, "Back"),
    heading: createElement("h1", null, "Automations"),
    actions: createElement("span", null, "New automation"),
  });

  assert.equal(banner.textContent, "BackAutomationsNew automation");
  assert.equal(banner.querySelector("h1")?.textContent, "Automations");
});

test("a strip given only a way back holds that alone", () => {
  const banner = draw({ lead: createElement("span", null, "Settings") });

  assert.equal(banner.textContent, "Settings");
});
