// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { InlineEdit, type InlineEditEnd } from "./inline-edit.js";

/**
 * inline-edit.test.ts -- words are shown until the caller edits them, then a
 * field named for a reader opens over them with all of them selected;
 * Return and the focus leaving keep what was typed, Escape keeps the words
 * it opened on and goes no further, an input method's Return and Escape end
 * nothing, words left empty or unchanged change nothing, and an edit ends
 * once.
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

/** Types `value` into `field` as the page would hand it to React. */
function type(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Presses a key in `field`, answering whether it went past the field. */
function press(field: HTMLElement, init: KeyboardEventInit): boolean {
  let heard = false;
  const listen = () => {
    heard = true;
  };
  document.addEventListener("keydown", listen);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  document.removeEventListener("keydown", listen);
  return heard;
}

function blur(field: HTMLElement): void {
  act(() => field.blur());
}

/**
 * A name a caller renames in place, as a list renames a row: Rename opens
 * the edit, every end is kept, and the edit closes on it unless `stays`.
 */
function Renamed({
  start,
  ends,
  stays = false,
}: {
  start: string;
  ends: InlineEditEnd[];
  stays?: boolean;
}): React.JSX.Element {
  const [name, setName] = useState(start);
  const [editing, setEditing] = useState(false);
  return createElement(
    "div",
    null,
    createElement(InlineEdit, {
      value: name,
      label: "Task name",
      editing,
      maxLength: 40,
      onEnd: (end: InlineEditEnd) => {
        ends.push(end);
        if (!stays) setEditing(false);
        if (end.value !== undefined) setName(end.value);
      },
    }),
    createElement("button", { type: "button", onClick: () => setEditing(true) }, "Rename"),
  );
}

function rename(container: HTMLElement): HTMLInputElement {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Rename");
  assert.ok(button);
  act(() => button.click());
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Task name"]');
  assert.ok(field);
  return field;
}

function field(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[aria-label="Task name"]');
}

/** The field, which must be open. */
function opened(container: HTMLElement): HTMLInputElement {
  const input = field(container);
  assert.ok(input);
  return input;
}

test("shows the words as they stand, or what the caller draws, until it edits them", () => {
  const plain = render(createElement(Renamed, { start: "Ship the beta", ends: [] }));
  assert.match(plain.textContent ?? "", /Ship the beta/);
  assert.equal(field(plain), null);

  const drawn = render(
    createElement(
      InlineEdit,
      { value: "Ship the beta", label: "Task name", editing: false, onEnd: () => undefined },
      createElement("strong", null, "Drawn name"),
    ),
  );
  assert.equal(drawn.textContent, "Drawn name");
});

test("opens a field over the words, focused with all of them selected", () => {
  const container = render(createElement(Renamed, { start: "Ship the beta", ends: [] }));
  const input = rename(container);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "Ship the beta");
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, "Ship the beta".length);
  assert.doesNotMatch(container.textContent ?? "", /Ship the beta/);
});

test("Return keeps what was typed, trimmed, and says a key ended it", () => {
  const ends: InlineEditEnd[] = [];
  const container = render(createElement(Renamed, { start: "Ship the beta", ends }));
  type(rename(container), "  Ship the launch ");
  press(opened(container), { key: "Enter" });
  assert.deepEqual(ends, [{ value: "Ship the launch", byKey: true }]);
  assert.equal(field(container), null);
  assert.match(container.textContent ?? "", /Ship the launch/);
});

test("Escape keeps the words it opened on and goes no further than the field", () => {
  const ends: InlineEditEnd[] = [];
  const container = render(createElement(Renamed, { start: "Ship the beta", ends }));
  type(rename(container), "Ship the launch");
  const heard = press(opened(container), { key: "Escape" });
  assert.equal(heard, false);
  assert.deepEqual(ends, [{ value: undefined, byKey: true }]);
  assert.match(container.textContent ?? "", /Ship the beta/);
});

test("the focus leaving keeps what was typed, and no key ended it", () => {
  const ends: InlineEditEnd[] = [];
  const container = render(createElement(Renamed, { start: "Ship the beta", ends }));
  type(rename(container), "Ship the launch");
  blur(opened(container));
  assert.deepEqual(ends, [{ value: "Ship the launch", byKey: false }]);
});

test("words left empty or unchanged change nothing", () => {
  const ends: InlineEditEnd[] = [];
  const container = render(createElement(Renamed, { start: "Ship the beta", ends }));
  type(rename(container), "   ");
  press(opened(container), { key: "Enter" });
  type(rename(container), " Ship the beta ");
  press(opened(container), { key: "Enter" });
  assert.deepEqual(ends, [
    { value: undefined, byKey: true },
    { value: undefined, byKey: true },
  ]);
  assert.match(container.textContent ?? "", /Ship the beta/);
});

test("an input method's Return and Escape end nothing, and its Escape goes no further", () => {
  const ends: InlineEditEnd[] = [];
  const container = render(createElement(Renamed, { start: "Ship the beta", ends }));
  const input = rename(container);
  type(input, "出荷");
  press(input, { key: "Enter", isComposing: true });
  press(input, { key: "Enter", keyCode: 229 });
  const heard = press(input, { key: "Escape", isComposing: true });
  assert.equal(heard, false);
  assert.deepEqual(ends, []);
  assert.equal(field(container), input);
  press(input, { key: "Enter" });
  assert.deepEqual(ends, [{ value: "出荷", byKey: true }]);
});

test("an edit ends once, whichever end comes first", () => {
  const ends: InlineEditEnd[] = [];
  const container = render(createElement(Renamed, { start: "Ship the beta", ends, stays: true }));
  const input = rename(container);
  type(input, "Ship the launch");
  press(input, { key: "Escape" });
  press(input, { key: "Enter" });
  blur(input);
  assert.deepEqual(ends, [{ value: undefined, byKey: true }]);
});
