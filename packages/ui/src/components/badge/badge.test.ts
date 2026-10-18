// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { BADGE_TONE, Badge } from "./badge.js";

/**
 * badge.test.ts -- a badge is read by its words, and a provider's colour
 * worn as a dot before them is never read in their stead.
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

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a label's colour is a dot hidden from a reader, who hears its name", () => {
  const view = render(createElement(Badge, { swatch: "d73a4a", children: "bug" }));
  assert.equal(view.textContent, "bug");
  const hidden = view.querySelectorAll('[aria-hidden="true"]');
  assert.equal(hidden.length, 1, "the dot");
  assert.equal(hidden[0]?.textContent, "");
});

test("a badge with no colour of a provider's wears no dot", () => {
  const view = render(createElement(Badge, { tone: BADGE_TONE.WORKING, children: "Working" }));
  assert.equal(view.textContent, "Working");
  assert.equal(view.querySelectorAll('[aria-hidden="true"]').length, 0);
});
