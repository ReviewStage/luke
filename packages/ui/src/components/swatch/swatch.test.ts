// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Swatch } from "./swatch.js";

/**
 * swatch.test.ts -- a swatch is a button named by its label that says
 * whether its colour is the one chosen, and a press hands the choice on.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container on the page and returns its button. */
function mount(element: React.ReactElement): HTMLButtonElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const button = container.querySelector("button");
  if (button === null) throw new Error("no button drawn");
  return button;
}

test("names itself and announces whether it is chosen", () => {
  const button = mount(
    createElement(Swatch, { color: "red", label: "Red", pressed: true, onClick: () => {} }),
  );
  expect(button.getAttribute("aria-label")).toBe("Red");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.type).toBe("button");
});

test("a press hands the choice on", () => {
  const onClick = vi.fn();
  const button = mount(createElement(Swatch, { label: "No color", pressed: false, onClick }));
  act(() => button.click());
  expect(onClick).toHaveBeenCalledOnce();
});

test("one that is not tabbable stays out of the tab order", () => {
  const button = mount(
    createElement(Swatch, { label: "Blue", pressed: false, tabbable: false, onClick: () => {} }),
  );
  expect(button.tabIndex).toBe(-1);
});
