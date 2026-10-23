// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { HarnessMark } from "./harness-mark.js";

/**
 * Claude's mark is Clawd drawn inline in its own clay, and Codex's is the
 * picture the app serves, at each density.
 */

const CODEX_ART = { oneX: "/a/codex-16.png", twoX: "/a/codex-32.png", threeX: "/a/codex-48.png" };

function drawn(provider: ModelProvider): Element {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    createElement(HarnessMark, { provider, codexArt: CODEX_ART }),
  );
  return page.querySelector(".luke-harness-mark") ?? assert.fail("a mark is drawn");
}

test("Claude's mark is Clawd, an inline glyph in its own clay", () => {
  const mark = drawn(MODEL_PROVIDER.ANTHROPIC);
  assert.equal(mark.tagName.toLowerCase(), "svg");
  assert.equal(mark.getAttribute("viewBox"), "0 0 47 38");
  assert.equal(mark.querySelector("path")?.getAttribute("fill"), "#D97757");
});

test("Codex's mark is the picture the app serves, at one, two, and three device pixels to the pixel", () => {
  const mark = drawn(MODEL_PROVIDER.OPENAI);
  assert.equal(mark.tagName.toLowerCase(), "img");
  assert.equal(mark.getAttribute("src"), "/a/codex-16.png");
  assert.equal(
    mark.getAttribute("srcset"),
    "/a/codex-16.png 1x, /a/codex-32.png 2x, /a/codex-48.png 3x",
  );
});
