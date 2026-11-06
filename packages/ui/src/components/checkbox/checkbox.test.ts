// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Checkbox } from "./checkbox.js";

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

function box(page: HTMLElement): HTMLElement {
  return page.querySelector<HTMLElement>('[role="checkbox"]') ?? assert.fail("no box");
}

function said(page: HTMLElement): string | null {
  return box(page).getAttribute("aria-checked");
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
  assert.equal(said(page), "true");
});

test("Space on the box checks it and Space again unchecks it", () => {
  const page = render(createElement(Signed));
  const space = () =>
    act(() => {
      box(page).dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      box(page).dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    });
  space();
  space();
  assert.equal(page.querySelector("output")?.textContent, "true,false");
  assert.equal(said(page), "false");
});

test("a mixed box reads as mixed and resolves to checked whatever its caller last held", () => {
  for (const start of [false, true]) {
    const page = render(createElement(Signed, { mixed: true, start }));
    assert.equal(said(page), "mixed");
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
  assert.equal(box(page).getAttribute("aria-disabled"), "true");
  press(box(page));
  assert.equal(page.querySelector("output")?.textContent, "");
});

test("a read-only box stands as its caller holds it, checked or not, and hands on no press of the box or its words", () => {
  for (const start of [false, true]) {
    const page = render(createElement(Signed, { readOnly: true, start }));
    assert.notEqual(
      box(page).getAttribute("aria-disabled"),
      "true",
      "it is not unavailable, so it is not faded",
    );
    assert.equal(box(page).getAttribute("aria-readonly"), "true");
    press(box(page));
    press(page.querySelector("label"));
    assert.equal(said(page), String(start));
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
  assert.equal(page.querySelector(".ui-checkbox-words"), null);
  press(page.querySelector("label"));
  assert.deepEqual(heard, [true]);
});
