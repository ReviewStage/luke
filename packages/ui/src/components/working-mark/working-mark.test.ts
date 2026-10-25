// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { Shimmer } from "../shimmer/shimmer.js";
import { ThinkingDots } from "../thinking-dots/thinking-dots.js";
import { WorkingMark } from "./working-mark.js";

/**
 * working-mark.test.ts -- the loading marks are decorative, hidden from a
 * reader, and the shimmer says its words alone.
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

test("the working mark is hidden from a reader", () => {
  const mark = render(createElement(WorkingMark)).querySelector("svg.luke-working-mark");
  assert.equal(mark?.getAttribute("aria-hidden"), "true");
});

test("the thinking dots are hidden from a reader", () => {
  const dots = render(createElement(ThinkingDots)).querySelector(".luke-thinking-dots");
  assert.equal(dots?.getAttribute("aria-hidden"), "true");
});

test("the shimmer says its words and passes props on", () => {
  const line = render(createElement(Shimmer, { children: "Working", "aria-live": "polite" }));
  const span = line.querySelector(".luke-shimmer");
  assert.equal(span?.textContent, "Working");
  assert.equal(span?.getAttribute("aria-live"), "polite");
});
