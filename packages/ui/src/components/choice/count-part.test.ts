// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { COUNT_TONE, CountParts, linesCount } from "./count-part.js";

/**
 * count-part.test.ts -- a diff's line count is two parts, the lines added
 * in the complete tone and the lines removed in the danger tone, read as one
 * count; a part's glyph says its state in words.
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

test("a diff's lines are added in the complete tone and removed in the danger tone", () => {
  assert.deepEqual(linesCount(214, 38), [
    { text: "+214", tone: COUNT_TONE.COMPLETE },
    { text: "−38", tone: COUNT_TONE.DANGER },
  ]);
  assert.deepEqual(
    linesCount(0, 0).map((part) => part.tone),
    [COUNT_TONE.COMPLETE, COUNT_TONE.DANGER],
    "an empty diff's count still carries its colours",
  );
});

test("a count's parts read as one count, a space between each", () => {
  const page = render(createElement(CountParts, { parts: linesCount(214, 38) }));
  assert.equal(page.textContent, "+214 −38");
});

test("a part's glyph says its state in words beside its text", () => {
  const page = render(
    createElement(CountParts, {
      parts: [{ text: "1", tone: COUNT_TONE.DANGER, glyph: "×", glyphLabel: "failing" }],
    }),
  );
  assert.equal(page.querySelector('[role="img"]')?.getAttribute("aria-label"), "failing");
  assert.equal(page.textContent, "×1");
});
