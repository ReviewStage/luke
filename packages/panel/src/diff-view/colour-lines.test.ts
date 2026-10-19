/**
 * colour-lines.test.ts -- Pierre's colouring of a file read back as a File tab's runs: one run per colour, each in both appearances, the line's break left off, and each theme's ground and ink; and no result where the lines or the themes are not all there. Synthetic markup only.
 */

import assert from "node:assert/strict";
import type { Element, ElementContent } from "hast";
import { test } from "vitest";
import { colouredFrom } from "./colour-lines.js";

/** A token's span as Pierre writes it, coloured in each theme. */
function token(text: string, dark: string, light: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { style: `--diffs-token-dark:${dark};--diffs-token-light:${light}` },
    children: [{ type: "text", value: text }],
  };
}

/** A line's element as Pierre writes it, holding its tokens. */
function line(...tokens: ElementContent[]): Element {
  return { type: "element", tagName: "div", properties: { "data-line": 1 }, children: tokens };
}

const THEMES =
  "--diffs-dark:#F8F8F2;--diffs-dark-bg:#282A36;--diffs-light:#657B83;--diffs-light-bg:#FDF6E3";

test("each line's tokens are read back as runs, one per colour in both appearances, its break left off", () => {
  const coloured = colouredFrom(
    {
      code: [
        line(
          token("const", "#FF79C6", "#859900"),
          token(" a", "#F8F8F2", "#268BD2"),
          token(" b", "#F8F8F2", "#268BD2"),
        ),
        line(token("\n", "#F8F8F2", "#657B83")),
        line(token("x", "#BD93F9", "#D33682"), token(";\n", "#F8F8F2", "#657B83")),
      ],
      themeStyles: THEMES,
    },
    3,
  );

  assert.deepEqual(coloured?.lines, [
    [
      { text: "const", color: "#ff79c6", lightColor: "#859900" },
      { text: " a b", color: "#f8f8f2", lightColor: "#268bd2" },
    ],
    [],
    [
      { text: "x", color: "#bd93f9", lightColor: "#d33682" },
      { text: ";", color: "#f8f8f2", lightColor: "#657b83" },
    ],
  ]);
  assert.deepEqual(coloured?.ground, { dark: "#282A36", light: "#FDF6E3" });
  assert.deepEqual(coloured?.ink, { dark: "#F8F8F2", light: "#657B83" });
});

test("lines coloured other than the run's, or themes left unnamed, give no result", () => {
  const code = [line(token("a", "#111111", "#222222"))];
  assert.equal(colouredFrom({ code, themeStyles: THEMES }, 2), undefined);
  assert.equal(colouredFrom({ code, themeStyles: "--diffs-dark:#fff" }, 1), undefined);
});
