// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PAGER_AXIS, PAGER_COUNT, Pager } from "./pager.js";

/**
 * pager.test.ts -- the pager says where the item stands, before its arrows
 * or between them, and an arrow with nowhere to go stays in the keyboard's
 * reach but steps nowhere, while the other steps.
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

/** What the pager reads as, its place and its arrows' names in order. */
function reading(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".luke-pager > *")].map(
    (each) => each.getAttribute("aria-label") ?? each.textContent ?? "",
  );
}

test("the place leads the arrows, or stands between them with the noun it counts", () => {
  const steps = {
    previous: { label: "Older run", onStep: () => {} },
    next: { label: "Newer run", onStep: () => {} },
  };
  const lead = render(
    createElement(Pager, { axis: PAGER_AXIS.VERTICAL, place: { at: 2, total: 8 }, ...steps }),
  );
  assert.deepEqual(reading(lead), ["2 of 8", "Older run", "Newer run"]);
  const between = render(
    createElement(Pager, {
      axis: PAGER_AXIS.HORIZONTAL,
      count: PAGER_COUNT.BETWEEN,
      place: { at: 3, total: 5, noun: "Run" },
      ...steps,
    }),
  );
  assert.deepEqual(reading(between), ["Older run", "Run 3 of 5", "Newer run"]);
});

test("an arrow with nowhere to go keeps the keyboard but steps nowhere, and the other steps", () => {
  const stepped: string[] = [];
  const container = render(
    createElement(Pager, {
      axis: PAGER_AXIS.HORIZONTAL,
      place: { at: 1, total: 3 },
      previous: { label: "Previous chapter", onStep: undefined },
      next: { label: "Next chapter", onStep: () => stepped.push("next") },
    }),
  );
  const [previous, next] = [...container.querySelectorAll<HTMLButtonElement>("button")];
  assert.ok(previous && next);
  assert.equal(previous.getAttribute("aria-disabled"), "true");
  assert.equal(previous.disabled, false, "it stays in the tab order");
  act(() => previous.click());
  act(() => next.click());
  assert.deepEqual(stepped, ["next"]);
});
