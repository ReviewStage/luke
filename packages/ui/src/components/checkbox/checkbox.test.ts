// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Checkbox } from "./checkbox.js";

/**
 * checkbox.test.ts -- a press on the box and a press on its words each hand
 * the caller the value they ask for, a mixed box resolves to checked while
 * still submitting what its caller holds, and an unavailable one changes
 * nothing; nor does a read-only one, which is not unavailable. A box named
 * by a label of its own draws no words.
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

/** A choice the caller holds, every change it was handed listed after it. */
function Signed({
  mixed = false,
  disabled = false,
  readOnly = false,
  start = false,
}): React.JSX.Element {
  const [signed, setSigned] = useState(start);
  const [heard, setHeard] = useState<boolean[]>([]);
  return createElement(
    "div",
    null,
    createElement(Checkbox, {
      checked: signed,
      mixed,
      disabled,
      readOnly,
      onChange: (value: boolean) => {
        setSigned(value);
        setHeard((all) => [...all, value]);
      },
      children: "Include my name and email",
    }),
    createElement("output", null, heard.join(",")),
  );
}

function box(page: HTMLElement): HTMLInputElement {
  return page.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? assert.fail("no box");
}

function press(element: HTMLElement | null): void {
  act(() => element?.click());
}

test("the box and its words each hand the caller the value they ask for", () => {
  const page = render(createElement(Signed));
  press(box(page));
  press(page.querySelector("label"));
  press(box(page));
  assert.equal(page.querySelector("output")?.textContent, "true,false,true");
  assert.equal(box(page).checked, true);
});

test("a mixed box reads as mixed and resolves to checked whatever its caller last held", () => {
  for (const start of [false, true]) {
    const page = render(createElement(Signed, { mixed: true, start }));
    assert.equal(box(page).indeterminate, true);
    press(box(page));
    assert.equal(page.querySelector("output")?.textContent, "true");
  }
});

test("a mixed box its caller holds checked still submits with its form", () => {
  const page = render(
    createElement(
      "form",
      null,
      createElement(Checkbox, {
        name: "servers",
        checked: true,
        mixed: true,
        onChange: () => undefined,
        children: "Every server",
      }),
    ),
  );
  const form = page.querySelector("form") ?? assert.fail("no form");
  assert.equal(new FormData(form).get("servers"), "on");
});

test("an unavailable box changes nothing", () => {
  const page = render(createElement(Signed, { disabled: true }));
  assert.equal(box(page).disabled, true);
  press(box(page));
  assert.equal(page.querySelector("output")?.textContent, "");
});

test("a read-only box stands as its caller holds it, checked or not, and hands on no press of the box or its words", () => {
  for (const start of [false, true]) {
    const page = render(createElement(Signed, { readOnly: true, start }));
    assert.equal(box(page).disabled, false, "it is not unavailable, so it is not faded");
    assert.equal(box(page).getAttribute("aria-readonly"), "true");
    press(box(page));
    press(page.querySelector("label"));
    assert.equal(box(page).checked, start);
    assert.equal(page.querySelector("output")?.textContent, "");
  }
});

test("a box named by a label of its own draws no words and is pressed as any box is", () => {
  const heard: boolean[] = [];
  const page = render(
    createElement(Checkbox, {
      label: "Send the invite",
      checked: false,
      onChange: (value: boolean) => heard.push(value),
    }),
  );
  assert.equal(box(page).getAttribute("aria-label"), "Send the invite");
  assert.equal(page.querySelector(".luke-checkbox-words"), null);
  press(page.querySelector("label"));
  assert.deepEqual(heard, [true]);
});

test("a box is named by its words or by a label of its own, and never by neither", () => {
  // @ts-expect-error A box with neither words nor a label would stand unnamed.
  createElement(Checkbox, { checked: false, onChange: () => undefined });
});
