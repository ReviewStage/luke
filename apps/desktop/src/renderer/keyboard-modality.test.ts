// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useKeyboardModality } from "./keyboard-modality";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  delete document.documentElement.dataset.keyboard;
});

function Window(): null {
  useKeyboardModality();
  return null;
}

test("the root says the keyboard moved focus after Tab or an arrow, and stops saying so at the next press of the pointer", () => {
  act(() => {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Window));
  });
  const keyboard = () => document.documentElement.dataset.keyboard;
  assert.equal(keyboard(), undefined);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  });
  assert.equal(keyboard(), undefined);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  });
  assert.equal(keyboard(), "true");
  act(() => {
    window.dispatchEvent(new Event("pointerdown"));
  });
  assert.equal(keyboard(), undefined);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  });
  assert.equal(keyboard(), "true");
});
