// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Checkbox } from "../checkbox/checkbox.js";
import { ChoiceList } from "../choice-list/choice-list.js";
import { ReadableControls } from "./readable-controls.js";

/**
 * readable-controls.test.ts -- a press whose drag selected a control's words
 * neither picks an option nor ticks a box, while a press that selects
 * nothing, a press from the keyboard, and a press beside a selection made
 * before it all press as they always do.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** An option to pick and a step to tick, inside a readable region, every change listed after them. */
function Ask(): React.JSX.Element {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [ticked, setTicked] = useState(false);
  return createElement(
    "div",
    null,
    createElement(
      ReadableControls,
      null,
      createElement(ChoiceList, {
        legend: "Options",
        options: [{ value: "ship", label: "Ship it", detail: "Merge once checks pass" }],
        value: picked,
        clearable: true,
        onChange: setPicked,
      }),
      createElement(Checkbox, {
        checked: ticked,
        onChange: setTicked,
        children: "Run pnpm install",
      }),
    ),
    createElement("output", null, `${picked.join(",")}|${String(ticked)}`),
  );
}

function words(page: HTMLElement, selector: string): HTMLElement {
  return page.querySelector<HTMLElement>(selector) ?? assert.fail(`no ${selector}`);
}

/** Selects all of an element's words, as a drag over them does. */
function select(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

/** A press of the pointer on `element`, with whatever `during` does between its down and its click. */
function press(element: HTMLElement, during: () => void = () => undefined): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    during();
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

function heard(page: HTMLElement): string | null | undefined {
  return page.querySelector("output")?.textContent;
}

test("a drag that selects an option's or a step's words neither picks nor ticks", () => {
  const page = render(createElement(Ask));
  const detail = words(page, ".luke-choice-detail");
  press(detail, () => select(detail));
  const step = words(page, ".luke-checkbox-words");
  press(step, () => select(step));
  assert.equal(heard(page), "|false");
  assert.equal(document.getSelection()?.toString(), "Run pnpm install");
});

test("a press that selects nothing picks and ticks as it always does", () => {
  const page = render(createElement(Ask));
  press(words(page, ".luke-choice-label"));
  press(words(page, ".luke-checkbox-words"));
  assert.equal(heard(page), "ship|true");
});

test("a press beside a selection made before it still presses", () => {
  const page = render(createElement(Ask));
  select(words(page, ".luke-choice-detail"));
  press(words(page, ".luke-choice-label"));
  press(words(page, ".luke-checkbox-words"));
  assert.equal(heard(page), "ship|true");
});

test("a press from the keyboard presses whatever stands selected", () => {
  const page = render(createElement(Ask));
  select(words(page, ".luke-choice-detail"));
  act(() => words(page, '[role="radio"]').click());
  assert.equal(heard(page), "ship|false");
});
