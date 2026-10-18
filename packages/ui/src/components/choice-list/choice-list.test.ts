// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CHOICE_SELECT, ChoiceList, type ChoiceOption, type ChoiceSelect } from "./choice-list.js";

/**
 * choice-list.test.ts -- a pick-one list is a radio group the arrows walk
 * past an unavailable row, a press on its checked row keeping or clearing
 * the choice as asked; a pick-several list toggles each row on its own; and
 * a settled list names what was picked and takes no press.
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

type Retry = "three" | "once" | "never";

const OPTIONS: readonly ChoiceOption<Retry>[] = [
  { value: "three", label: "Retry 3 times", detail: "Over an hour.", badge: "Recommended" },
  { value: "once", label: "Retry once", detail: "Can't retry: the queue is full.", disabled: true },
  { value: "never", label: "Never retry" },
];

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A list whose value its caller holds, every change it was handed listed after it. */
function Held({
  select,
  clearable = false,
  disabled = false,
  start = [],
}: {
  select?: ChoiceSelect;
  clearable?: boolean;
  disabled?: boolean;
  start?: readonly Retry[];
}): React.JSX.Element {
  const [value, setValue] = useState<readonly Retry[]>(start);
  const [heard, setHeard] = useState<string[]>([]);
  return createElement(
    "div",
    null,
    createElement(ChoiceList<Retry>, {
      legend: "Retries",
      options: OPTIONS,
      value,
      select,
      clearable,
      disabled,
      onChange: (next: readonly Retry[]) => {
        setValue(next);
        setHeard((all) => [...all, next.join("+") || "none"]);
      },
    }),
    createElement("output", null, heard.join(",")),
  );
}

function rows(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>("button")];
}

function row(page: HTMLElement, label: string): HTMLButtonElement {
  return (
    rows(page).find((each) => each.textContent?.startsWith(label)) ?? assert.fail(`no ${label}`)
  );
}

function heard(page: HTMLElement): string | null | undefined {
  return page.querySelector("output")?.textContent;
}

function key(element: Element, name: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

test("a pick-one list is a radio group named by its legend, each row a radio checked while it is the value", () => {
  const page = render(createElement(Held, { start: ["never"] }));
  const group = page.querySelector('[role="radiogroup"]');
  assert.equal(group?.getAttribute("aria-label"), "Retries");
  assert.deepEqual(
    rows(page).map((each) => [each.getAttribute("role"), each.getAttribute("aria-checked")]),
    [
      ["radio", "false"],
      ["radio", "false"],
      ["radio", "true"],
    ],
  );
  assert.equal(row(page, "Retry 3 times").textContent, "Retry 3 timesRecommendedOver an hour.");
});

test("Tab lands on the checked row alone, or the first open one while none is checked", () => {
  const tabStops = (page: HTMLElement) =>
    rows(page)
      .filter((each) => each.tabIndex === 0)
      .map((each) => each.textContent?.slice(0, 11));
  assert.deepEqual(tabStops(render(createElement(Held, { start: ["never"] }))), ["Never retry"]);
  assert.deepEqual(tabStops(render(createElement(Held))), ["Retry 3 tim"]);
});

test("the arrows choose the next open row, past an unavailable one, wrapping at either end, and take the keyboard there", () => {
  const page = render(createElement(Held, { start: ["three"] }));
  const three = row(page, "Retry 3 times");
  act(() => three.focus());
  key(three, "ArrowDown");
  assert.equal(document.activeElement, row(page, "Never retry"));
  key(row(page, "Never retry"), "ArrowDown");
  assert.equal(document.activeElement, three);
  key(three, "ArrowUp");
  assert.equal(heard(page), "never,three,never");
  assert.equal(row(page, "Retry once").disabled, true);
});

test("a press chooses a row; a press on the checked row keeps it, unless the list is clearable", () => {
  const kept = render(createElement(Held));
  act(() => row(kept, "Never retry").click());
  act(() => row(kept, "Never retry").click());
  assert.equal(heard(kept), "never");

  const cleared = render(createElement(Held, { clearable: true }));
  act(() => row(cleared, "Never retry").click());
  act(() => row(cleared, "Never retry").click());
  assert.equal(heard(cleared), "never,none");
  assert.equal(row(cleared, "Never retry").getAttribute("aria-checked"), "false");
});

test("a pick-several list is a group of checkboxes, each its own Tab stop, toggled on its own", () => {
  const page = render(createElement(Held, { select: CHOICE_SELECT.MANY }));
  assert.equal(page.querySelector("fieldset")?.getAttribute("aria-label"), "Retries");
  assert.deepEqual(
    rows(page).map((each) => [each.getAttribute("role"), each.tabIndex]),
    [
      ["checkbox", 0],
      ["checkbox", 0],
      ["checkbox", 0],
    ],
  );
  act(() => row(page, "Retry 3 times").click());
  act(() => row(page, "Never retry").click());
  act(() => row(page, "Retry 3 times").click());
  assert.equal(heard(page), "three,three+never,never");
  assert.equal(row(page, "Never retry").getAttribute("aria-checked"), "true");
});

test("an unavailable list changes nothing, by press or by key", () => {
  const page = render(createElement(Held, { disabled: true, start: ["three"] }));
  act(() => row(page, "Never retry").click());
  key(row(page, "Retry 3 times"), "ArrowDown");
  assert.equal(heard(page), "");
});

test("a settled list names each option, the pick beside its note and the rest without, and offers nothing to press", () => {
  const page = render(
    createElement(ChoiceList<Retry>, {
      legend: "What was offered",
      options: OPTIONS,
      value: ["never"],
      settled: true,
      pickedNote: "Your pick",
    }),
  );
  const list = page.querySelector("ul") ?? assert.fail("no list");
  assert.equal(list.getAttribute("aria-label"), "What was offered");
  assert.deepEqual(
    [...list.querySelectorAll("li")].map((each) => each.textContent),
    [
      "Retry 3 timesRecommendedOver an hour.",
      "Retry onceCan't retry: the queue is full.",
      "Never retryYour pick",
    ],
  );
  assert.equal(rows(page).length, 0);
});
