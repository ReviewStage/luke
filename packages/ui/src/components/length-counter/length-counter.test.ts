// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { holdExits } from "../../testing/held-exits.js";
import { FormField } from "../form-field/form-field.js";
import { TextField } from "../text-field/text-field.js";

/**
 * length-counter.test.ts -- a field with a limit says nothing of it until
 * its words reach four fifths of it, then counts them on its label's line,
 * each change a tick travelling the way the count moved, in the danger ink
 * at the limit, and once the words draw back it leaves through its exit.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LIMIT = 10;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A name field of ten characters at most, as a workspace's name is bounded. */
function Named(): React.JSX.Element {
  const [name, setName] = useState("");
  return createElement(FormField, {
    label: "Name",
    count: { length: name.length, limit: LIMIT },
    children: (control) =>
      createElement(TextField, {
        field: control,
        value: name,
        onChange: setName,
        maxLength: LIMIT,
      }),
  });
}

function render(): HTMLElement {
  const page = document.body.appendChild(document.createElement("div"));
  const root = createRoot(page);
  roots.push(root);
  act(() => root.render(createElement(Named)));
  return page;
}

function type(page: HTMLElement, value: string): void {
  const field = page.querySelector("input") ?? assert.fail("a field");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const counter = (page: HTMLElement) => page.querySelector<HTMLElement>(".luke-length-counter");
const count = (page: HTMLElement) => page.querySelector<HTMLElement>(".luke-length-counter-count");

test("the count stands only once the words reach four fifths of the limit", () => {
  const page = render();
  type(page, "1234567");
  assert.equal(counter(page), null);
  type(page, "12345678");
  assert.equal(counter(page)?.textContent, "8/10");
  assert.equal(
    page.querySelector("label")?.textContent,
    "Name",
    "the label still names the field alone",
  );
});

test("each change ticks the way the count moved, in the danger ink at the limit", () => {
  const page = render();
  type(page, "12345678");
  type(page, "123456789");
  const nine = count(page);
  assert.equal(nine?.dataset.move, "up");
  type(page, "1234567890");
  assert.notEqual(count(page), nine, "a figure of its own, its tick from the start");
  assert.equal(counter(page)?.dataset.full, "true");
  type(page, "123456789");
  assert.equal(count(page)?.dataset.move, "down");
  assert.equal(counter(page)?.dataset.full, undefined);
});

test("drawn back under four fifths, the count leaves through its exit", () => {
  const exits = holdExits();
  try {
    const page = render();
    type(page, "12345678");
    type(page, "123");
    assert.equal(counter(page)?.dataset.leaving, "true", "drawn through its exit");
    act(() => exits.finish());
    assert.equal(counter(page), null);
  } finally {
    exits.restore();
  }
});
