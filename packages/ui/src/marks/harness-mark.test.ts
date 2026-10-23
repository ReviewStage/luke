// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { HarnessMark } from "./harness-mark.js";

/**
 * Each harness's mark is a glyph of ours drawn inline in the ink of the row
 * it stands in: no picture fetched from beside the bundle and no vendor's
 * own colour, and Claude's and Codex's are told apart.
 */

function drawn(provider: (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER]): Element {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(createElement(HarnessMark, { provider }));
  return page.firstElementChild ?? assert.fail("a mark is drawn");
}

test("each harness draws its own inline glyph in the ink of what it stands in", () => {
  const marks = Object.values(MODEL_PROVIDER).map(drawn);
  for (const mark of marks) {
    assert.equal(mark.tagName.toLowerCase(), "svg");
    assert.equal(mark.querySelector("img, image"), null, "nothing is fetched");
    assert.equal(mark.getAttribute("stroke"), "currentColor");
    assert.equal(mark.querySelector("[fill]:not([fill='none'])"), null, "no colour of its own");
  }
  assert.notEqual(marks[0]?.innerHTML, marks[1]?.innerHTML, "the two harnesses read apart");
});
