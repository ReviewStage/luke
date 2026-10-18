// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Progress } from "./progress.js";

/**
 * progress.test.ts -- a bar given a label is a progress bar a reader hears
 * by it, at its share held to the whole; one beside words that say the same
 * says nothing more.
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

test("a labelled bar is a progress bar a reader hears by its label and its share", () => {
  const view = render(createElement(Progress, { value: 42.4, label: "Downloading the update" }));
  const bar = view.querySelector('[role="progressbar"]') ?? assert.fail("a progress bar");
  assert.equal(bar.getAttribute("aria-label"), "Downloading the update");
  assert.equal(bar.getAttribute("aria-valuenow"), "42");
  assert.equal(bar.getAttribute("aria-valuemax"), "100");
});

test("a share past either end is held to the whole, and one that is not a number to none", () => {
  const over = render(createElement(Progress, { value: 140, label: "Uploading" }));
  assert.equal(over.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "100");
  const broken = render(createElement(Progress, { value: Number.NaN, label: "Uploading" }));
  assert.equal(broken.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "0");
});

test("a bar beside words that say the same is hidden from a reader", () => {
  const view = render(
    createElement("p", null, "12 of 40 MB", createElement(Progress, { value: 30 })),
  );
  assert.equal(view.querySelector('[role="progressbar"]'), null);
  assert.equal(view.querySelector('[aria-hidden="true"]')?.textContent, "");
  assert.equal(view.textContent, "12 of 40 MB");
});
