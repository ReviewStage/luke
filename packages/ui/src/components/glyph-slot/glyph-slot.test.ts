// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { GLYPH_INK, GlyphSlot } from "./glyph-slot.js";

/**
 * glyph-slot.test.ts -- a glyph that only repeats its line's words is
 * hidden from a reader, and one that says more than they do is an image
 * named by what it says.
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

/** Draws `element` into a fresh container on the page. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a glyph that repeats its words is hidden from a reader, and one that says more is an image named by it", () => {
  const container = mount(
    createElement(
      "p",
      null,
      createElement(GlyphSlot, { children: createElement("svg") }),
      "Read src/send.ts",
      createElement(GlyphSlot, {
        ink: GLYPH_INK.TEXT,
        label: "In progress",
        children: createElement("svg"),
      }),
      "Send the invite",
    ),
  );
  const [quiet, named] = [...container.querySelectorAll("p > span")];

  assert.equal(quiet?.getAttribute("aria-hidden"), "true");
  assert.equal(quiet?.getAttribute("role"), null);
  assert.equal(named?.getAttribute("role"), "img");
  assert.equal(named?.getAttribute("aria-label"), "In progress");
  assert.equal(named?.getAttribute("aria-hidden"), null);
});
