import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { GLYPH } from "./glyph-registry.js";

/**
 * glyph-registry.test.ts -- one glyph per meaning and one meaning per glyph:
 * no two concepts are drawn by the same mark, and every mark is hidden from
 * a reader.
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

test("every concept draws a mark hidden from a reader", () => {
  for (const { concept, markup } of DRAWN) {
    assert.match(markup, /aria-hidden="true"/u, `${concept} is hidden from a reader`);
  }
});
