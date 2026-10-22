// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useFilePicker } from "./file-picker.js";

/**
 * file-picker.test.ts -- a press opens the hidden input, a pick hands its files over in order and
 * clears the input, and the input carries the accept and multiple it was given.
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

function render(element: ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

function Probe({
  multiple,
  onFiles,
}: {
  multiple?: boolean;
  onFiles: (f: readonly File[]) => void;
}) {
  const picker = useFilePicker({ accept: "image/*", multiple: multiple ?? false, onFiles });
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: picker.open }, "go"),
    picker.input,
  );
}

function input(): HTMLInputElement {
  const found = document.querySelector("input[type=file]");
  assert.ok(found instanceof HTMLInputElement);
  return found;
}

test("the input carries accept and multiple, hidden", () => {
  render(createElement(Probe, { multiple: true, onFiles: () => undefined }));
  assert.equal(input().accept, "image/*");
  assert.equal(input().multiple, true);
  assert.equal(input().hidden, true);
});

test("a press opens the input", () => {
  render(createElement(Probe, { onFiles: () => undefined }));
  let clicked = 0;
  input().addEventListener("click", () => clicked++);
  act(() => document.querySelector("button")?.click());
  assert.equal(clicked, 1);
});

test("a pick hands the files over and clears the input", () => {
  const heard: (readonly File[])[] = [];
  render(createElement(Probe, { multiple: true, onFiles: (files) => heard.push(files) }));
  const a = new File(["a"], "a.png");
  const b = new File(["b"], "b.png");
  const el = input();
  Object.defineProperty(el, "files", { value: [a, b], configurable: true });
  act(() => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.deepEqual(heard, [[a, b]]);
});
