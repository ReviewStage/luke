// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SecretField } from "./secret-field.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

interface Caller {
  empty: () => void;
}

function render(saved: boolean): Caller {
  const caller: Caller = { empty: () => undefined };
  function Holder(): React.JSX.Element {
    const [value, setValue] = useState("");
    caller.empty = () => setValue("");
    return createElement(SecretField, {
      label: "Personal access token",
      saved,
      value,
      onChange: setValue,
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Holder)));
  return caller;
}

function field(): HTMLInputElement {
  const input = document.querySelector("input");
  assert.ok(input);
  return input;
}

function toggle(word: "Show" | "Hide"): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${word}"]`);
  assert.ok(button, `the field offers ${word}`);
  return button;
}

function type(value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(button: HTMLButtonElement): void {
  act(() => button.click());
}

function pressable(button: HTMLButtonElement): boolean {
  return !button.disabled && button.getAttribute("aria-disabled") !== "true";
}

test("what is typed is masked, shown on Show, and masked again on Hide", () => {
  render(false);
  type("ghp_secret");
  assert.equal(field().type, "password");
  press(toggle("Show"));
  assert.equal(field().type, "text");
  assert.equal(field().value, "ghp_secret");
  press(toggle("Hide"));
  assert.equal(field().type, "password");
  assert.equal(field().value, "ghp_secret");
});

test("the system neither fills nor checks a secret", () => {
  render(false);
  assert.equal(field().getAttribute("autocomplete"), "off");
  assert.equal(field().getAttribute("spellcheck"), "false");
  assert.equal(field().getAttribute("autocorrect"), "off");
});

test("a secret already kept says Saved, holds nothing, and offers nothing to show", () => {
  render(true);
  assert.equal(field().placeholder, "Saved");
  assert.equal(field().value, "");
  assert.equal(field().type, "password");
  assert.equal(pressable(toggle("Show")), false, "there is nothing in the window to show");
});

test("a secret typed over a kept one is shown, and once emptied the field masks again", () => {
  const caller = render(true);
  type("ghp_next");
  press(toggle("Show"));
  assert.equal(field().type, "text");
  act(() => caller.empty());
  assert.equal(field().type, "password");
  assert.equal(field().placeholder, "Saved");
  type("ghp_after");
  assert.equal(field().type, "password", "the next secret arrives masked");
});
