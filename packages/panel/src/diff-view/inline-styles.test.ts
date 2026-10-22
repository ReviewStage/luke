import assert from "node:assert/strict";
import type { Element } from "hast";
import { test } from "vitest";
import { toHtml } from "./inline-styles.js";

/**
 * inline-styles.test.ts -- the HTML a diff is written as carries no `style` the
 * panel's policy would refuse: each inline style is written in the data
 * attribute the bundle applies through the CSSOM, and the tree Pierre keeps
 * to draw from again is left as it was. Synthetic markup only.
 */

/** A column with its row span, holding a token coloured in both themes and a plain one. */
function column(): Element {
  return {
    type: "element",
    tagName: "div",
    properties: { dataCode: "", style: "grid-row: span 2" },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { style: "--diffs-token-dark:#ff7b72;--diffs-token-light:#cf222e" },
        children: [{ type: "text", value: "const" }],
      },
      {
        type: "element",
        tagName: "span",
        properties: {},
        children: [{ type: "text", value: " a" }],
      },
    ],
  };
}

test("each inline style is written in the data attribute, never as a style", () => {
  const html = toHtml([column()]);

  assert.equal(
    html,
    '<div data-code="" data-inline-style="grid-row: span 2">' +
      '<span data-inline-style="--diffs-token-dark:#ff7b72;--diffs-token-light:#cf222e">const</span>' +
      "<span> a</span></div>",
  );
});

test("the tree written is left with its styles where they were", () => {
  const tree = column();
  const before = structuredClone(tree);

  toHtml(tree);

  assert.deepEqual(tree, before);
});
