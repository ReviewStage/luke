// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Slider } from "./slider.js";

/** slider.test.ts -- a slider is a named range input at its value, and tells of a change as a number. */

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

test("a slider is a range input named by its label, at its value and ends", () => {
  const container = render(
    createElement(Slider, { value: 30, label: "Swipe", onChange: () => {} }),
  );
  const input = container.querySelector("input");
  assert.equal(input?.type, "range");
  assert.equal(input?.getAttribute("aria-label"), "Swipe");
  assert.equal(input?.value, "30");
  assert.equal(input?.min, "0");
  assert.equal(input?.max, "100");
});

test("a change is told as a number", () => {
  const seen: number[] = [];
  const container = render(
    createElement(Slider, { value: 30, label: "Swipe", onChange: (v: number) => seen.push(v) }),
  );
  const input = container.querySelector("input");
  assert.ok(input);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, "70");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.deepEqual(seen, [70]);
});
