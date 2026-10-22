// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { Shimmer } from "../shimmer/shimmer.js";
import { ThinkingDots } from "../thinking-dots/thinking-dots.js";
import { WorkingMark } from "./working-mark.js";

/**
 * working-mark.test.ts -- the loading marks are decorative: the working mark
 * draws its eight track cells and four chasers, the dots their three, and the
 * shimmer its words alone.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  act(() => createRoot(container).render(element));
  return container;
}

test("the working mark laps four pixels over an eight-cell track, hidden from a reader", () => {
  const mark = render(createElement(WorkingMark)).querySelector("svg.luke-working-mark");
  assert.equal(mark?.getAttribute("aria-hidden"), "true");
  assert.equal(mark?.querySelectorAll(".luke-working-mark-track").length, 8);
  assert.equal(mark?.querySelectorAll(".luke-working-mark-dot").length, 4);
});

test("the thinking dots are three, hidden from a reader", () => {
  const dots = render(createElement(ThinkingDots)).querySelector(".luke-thinking-dots");
  assert.equal(dots?.getAttribute("aria-hidden"), "true");
  assert.equal(dots?.querySelectorAll("i").length, 3);
});

test("the shimmer says its words and passes props on", () => {
  const line = render(createElement(Shimmer, { children: "Working", "aria-live": "polite" }));
  const span = line.querySelector(".luke-shimmer");
  assert.equal(span?.textContent, "Working");
  assert.equal(span?.getAttribute("aria-live"), "polite");
});
