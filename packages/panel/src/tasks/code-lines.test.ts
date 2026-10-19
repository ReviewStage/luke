// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SCROLL_AXIS } from "@luke/ui";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CodeLinesView, type LinesLook } from "./code-lines.js";

/**
 * code-lines.test.ts -- numbered lines scroll in one area, the axis
 * the wrap setting says: wrapped, up and down alone; unwrapped, both
 * together. The caller's ref reaches that area, which is what a File tab
 * centres its lit line within. Synthetic lines.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINES = [[{ text: "const a = 1;" }], [{ text: "" }], [{ text: "export { a };" }]];

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** The lines drawn in `look`, the second pointed at, and the box the caller is handed as their scroller. */
function draw(look: LinesLook): HTMLDivElement {
  const scroller = createRef<HTMLDivElement>();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CodeLinesView, {
        look,
        firstLine: 10,
        lines: LINES,
        pointed: { path: "src/a.ts", startLine: 11, endLine: 11 },
        scrollerRef: scroller,
        above: createElement("p", null, "Show lines 1–9"),
      }),
    ),
  );
  return scroller.current ?? assert.fail("the caller is handed the scroller");
}

/** Each drawn line, its number then its text. */
function drawnLines(scroller: HTMLElement): string[] {
  return [...scroller.querySelectorAll(".code-line")].map(
    (line) =>
      `${line.querySelector(".code-line-number")?.textContent} ${line.querySelector(".code-line-text")?.textContent}`,
  );
}

test("wrapped lines scroll up and down alone, in the box the caller is handed", () => {
  const scroller = draw({ lineNumbers: true, wrap: true });

  assert.equal(scroller.getAttribute("data-axis"), SCROLL_AXIS.VERTICAL);
  assert.deepEqual(drawnLines(scroller), ["10 const a = 1;", "11 \n", "12 export { a };"]);
  assert.equal(
    scroller.querySelector("[data-pointed='true'] .code-line-number")?.textContent,
    "11",
  );
  assert.equal(
    scroller.querySelector(".code-lines")?.firstElementChild?.textContent,
    "Show lines 1–9",
  );
});

test("unwrapped lines scroll on both axes together, their gutter hidden as the setting says", () => {
  const scroller = draw({ lineNumbers: false, wrap: false });
  const lines = scroller.querySelector(".code-lines") ?? assert.fail("the lines are drawn");

  assert.equal(scroller.getAttribute("data-axis"), SCROLL_AXIS.BOTH);
  assert.equal(lines.getAttribute("data-wrap"), "false");
  assert.equal(lines.getAttribute("data-line-numbers"), "false");
});
