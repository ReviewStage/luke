// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "./text.js";

/**
 * text.test.ts -- words cut to one line still hold every word, so a heading
 * is named by its whole title rather than by what fits.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LONG_TITLE =
  "A station whose name runs far past the column it heads, so the row cuts it short";

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

test("a truncated heading is still named by its whole title", () => {
  const container = render(
    createElement(
      Text,
      { as: TEXT_ELEMENT.H2, variant: TEXT_VARIANT.SECTION, truncate: true },
      LONG_TITLE,
    ),
  );
  const heading = container.querySelector("h2");
  assert.ok(heading);
  assert.equal(heading.textContent, LONG_TITLE);
});
