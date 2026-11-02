// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PROGRESS_RING_TONE, ProgressCount, ProgressRing } from "./progress-ring.js";

/**
 * progress-ring.test.ts -- a count's ring is a picture whose share is the
 * count's, and a reader hears the label whole in place of the figures.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** How much of the ring's circle (radius 6) the fill covers, from its dash. */
function filledShare(view: HTMLElement): number {
  const fill = view.querySelectorAll("circle")[1] ?? assert.fail("a fill");
  const dash = Number.parseFloat(fill.getAttribute("stroke-dasharray") ?? "");
  return dash / (2 * Math.PI * 6);
}

test("a count draws its figures and a ring filled to their share, and a reader hears the label alone", () => {
  const view = render(
    createElement(ProgressCount, { done: 4, total: 6, label: "4 of 6 sub-tasks finished" }),
  );
  assert.ok(Math.abs(filledShare(view) - 4 / 6) < 1e-9);
  assert.equal(view.querySelector("svg")?.getAttribute("aria-hidden"), "true");
  assert.equal(view.querySelector('[aria-hidden="true"]:not(svg)')?.textContent, "4/6");
  assert.equal(view.textContent?.includes("4 of 6 sub-tasks finished"), true);
});

test("a count of none draws an empty ring, and a ring's share past either end is held to the circle", () => {
  const none = render(createElement(ProgressCount, { done: 0, total: 0, label: "No sub-tasks" }));
  assert.equal(filledShare(none), 0);
  const over = render(createElement(ProgressRing, { share: 3, tone: PROGRESS_RING_TONE.MUTED }));
  assert.equal(filledShare(over), 1);
});
