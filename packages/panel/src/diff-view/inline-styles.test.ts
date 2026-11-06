import assert from "node:assert/strict";
import type { Element } from "hast";
import { test } from "vitest";
import { toHtml } from "./inline-styles.js";

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
