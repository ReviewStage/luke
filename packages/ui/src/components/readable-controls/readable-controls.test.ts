// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Checkbox } from "../checkbox/checkbox.js";
import { ChoiceList } from "../choice-list/choice-list.js";
import { ReadableControls } from "./readable-controls.js";

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

function select(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

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
  const detail = words(page, ".ui-choice-detail");
  press(detail, () => select(detail));
  const step = words(page, ".ui-checkbox-words");
  press(step, () => select(step));
  assert.equal(heard(page), "|false");
  assert.equal(document.getSelection()?.toString(), "Run pnpm install");
});

test("a press that selects nothing picks and ticks as it always does", () => {
  const page = render(createElement(Ask));
  press(words(page, ".ui-choice-label"));
  press(words(page, ".ui-checkbox-words"));
  assert.equal(heard(page), "ship|true");
});

test("a press beside a selection made before it still presses", () => {
  const page = render(createElement(Ask));
  select(words(page, ".ui-choice-detail"));
  press(words(page, ".ui-choice-label"));
  press(words(page, ".ui-checkbox-words"));
  assert.equal(heard(page), "ship|true");
});

test("a press from the keyboard presses whatever stands selected", () => {
  const page = render(createElement(Ask));
  select(words(page, ".ui-choice-detail"));
  act(() => words(page, '[role="radio"]').click());
  assert.equal(heard(page), "ship|false");
});
