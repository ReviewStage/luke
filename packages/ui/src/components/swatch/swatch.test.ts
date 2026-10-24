// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Swatch } from "./swatch.js";

/**
 * swatch.test.ts -- a swatch is a button named by its label that says
 * whether its colour is the one chosen, and a press hands the choice on.
 * Chosen is drawn on the dot, never as the outline the keyboard's ring is.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  document.head.replaceChildren();
});

/** The swatch's own sheet, named apart from the read so the bundler leaves the path a file. */
const SHEET = "./swatch.css";

/** The swatch's sheet, its layer opened so jsdom keeps its rules. */
function laySheet(): void {
  const css = readFileSync(new URL(SHEET, import.meta.url), "utf8");
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = css.replace(/@layer [a-z-]+ \{([\s\S]*)\}\s*$/, "$1");
}

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
  expect(button.hasAttribute("data-none")).toBe(true);
});

test("one that is not tabbable stays out of the tab order", () => {
  const button = mount(
    createElement(Swatch, { label: "Blue", pressed: false, tabbable: false, onClick: () => {} }),
  );
  expect(button.tabIndex).toBe(-1);
});

test("a chosen swatch is marked on the dot, leaving the outline to the keyboard's ring", () => {
  laySheet();
  const chosen = mount(
    createElement(Swatch, { color: "red", label: "Red", pressed: true, onClick: () => {} }),
  );
  const other = mount(
    createElement(Swatch, { color: "blue", label: "Blue", pressed: false, onClick: () => {} }),
  );
  const drawn = (button: HTMLElement) => getComputedStyle(button);
  expect(drawn(chosen).getPropertyValue("outline")).toBe(drawn(other).getPropertyValue("outline"));
  expect(drawn(chosen).getPropertyValue("box-shadow")).not.toBe(
    drawn(other).getPropertyValue("box-shadow"),
  );
});
