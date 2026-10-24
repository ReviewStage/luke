import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { GLYPH } from "./glyph-registry.js";

/**
 * glyph-registry.test.ts -- one glyph per meaning and one meaning per glyph:
 * no two concepts are drawn by the same mark, and every glyph that is a line
 * drawing is drawn at the window's one stroke.
 */

const DRAWN = Object.entries(GLYPH).map(([concept, glyph]) => ({
  concept,
  markup: renderToStaticMarkup(createElement(glyph)),
}));

test("no two concepts are drawn by the same mark", () => {
  const first = new Map<string, string>();
  for (const { concept, markup } of DRAWN) {
    const sameAs = first.get(markup);
    assert.equal(sameAs, undefined, `${concept} is drawn as ${sameAs} is`);
    first.set(markup, concept);
  }
});

test("every concept draws a mark hidden from a reader, and a line drawing draws it at the window's stroke", () => {
  for (const { concept, markup } of DRAWN) {
    assert.match(markup, /^<svg /u, `${concept} draws an svg`);
    assert.match(markup, /aria-hidden="true"/u, `${concept} is hidden from a reader`);
    // The GitHub mark is a brand's solid art, which has no stroke to weigh.
    if (concept === "OPEN_ON_GITHUB") continue;
    assert.match(markup, /stroke-width="1\.9"/u, `${concept} is drawn at the one stroke`);
  }
});
