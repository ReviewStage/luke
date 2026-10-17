// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Segmented } from "./segmented.js";

/**
 * segmented.test.ts -- a segmented control is a radio group: the chosen
 * option is the one Tab lands on, the arrows choose as they move and wrap at
 * either end, and a press on the chosen option takes it back only where the
 * control is clearable.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EFFORTS = ["Low", "Medium", "High", "Highest"] as const;
type Effort = (typeof EFFORTS)[number];

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

/** An effort the caller holds, `clearable` as given. */
function EffortControl({ clearable = false }: { clearable?: boolean }): React.JSX.Element {
  const [effort, setEffort] = useState<Effort | undefined>("Medium");
  return createElement(Segmented<Effort>, {
    legend: "Effort",
    options: EFFORTS.map((value) => ({ value, label: value })),
    value: effort,
    clearable,
    onChange: setEffort,
  });
}

function radios(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

/** What a reader hears of the group: the options checked, and the one Tab lands on. */
interface Reading {
  readonly checked: string[];
  readonly tabStop: string[];
}

function reading(page: HTMLElement): Reading {
  return {
    checked: radios(page)
      .filter((radio) => radio.getAttribute("aria-checked") === "true")
      .map((radio) => radio.textContent ?? ""),
    tabStop: radios(page)
      .filter((radio) => radio.tabIndex === 0)
      .map((radio) => radio.textContent ?? ""),
  };
}

function pressKey(page: HTMLElement, key: string): void {
  const focused = document.activeElement ?? page;
  act(() => {
    focused.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

test("a radio group named by its legend, Tab landing on the chosen option", () => {
  const page = render(createElement(EffortControl));
  assert.equal(page.querySelector('[role="radiogroup"]')?.getAttribute("aria-label"), "Effort");
  assert.deepEqual(reading(page), { checked: ["Medium"], tabStop: ["Medium"] });
});

test("the arrows choose as they move and wrap at either end, taking the keyboard along", () => {
  const page = render(createElement(EffortControl));
  act(() => radios(page)[1]?.focus());
  pressKey(page, "ArrowRight");
  assert.deepEqual(reading(page), { checked: ["High"], tabStop: ["High"] });
  assert.equal(document.activeElement?.textContent, "High");
  pressKey(page, "ArrowLeft");
  pressKey(page, "ArrowLeft");
  pressKey(page, "ArrowLeft");
  assert.deepEqual(reading(page).checked, ["Highest"]);
  assert.equal(document.activeElement?.textContent, "Highest");
});

test("a press on the chosen option takes it back only where the control is clearable", () => {
  const fixed = render(createElement(EffortControl));
  act(() => radios(fixed)[1]?.click());
  assert.deepEqual(reading(fixed).checked, ["Medium"]);
  const clearable = render(createElement(EffortControl, { clearable: true }));
  act(() => radios(clearable)[1]?.click());
  assert.deepEqual(reading(clearable), { checked: [], tabStop: ["Low"] });
});
