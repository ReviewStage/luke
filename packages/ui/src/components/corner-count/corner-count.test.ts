// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CornerCount } from "./corner-count.js";

/**
 * corner-count.test.ts -- a count at a glyph's corner is drawn only while
 * something waits, and is hidden from a reader, who hears it in the press's
 * name.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function mount(count: number): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(CornerCount, { count, children: createElement("svg") })));
  return container;
}

test("a count stands on the glyph, hidden from a reader, while something waits", () => {
  const mark = mount(3).querySelector(".luke-corner-count-mark");
  assert.equal(mark?.textContent, "3");
  assert.equal(mark?.getAttribute("aria-hidden"), "true");
});

test("nothing waiting draws the glyph alone", () => {
  const view = mount(0);
  assert.ok(view.querySelector("svg"));
  assert.equal(view.querySelector(".luke-corner-count-mark"), null);
});
