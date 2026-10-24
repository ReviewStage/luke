// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * focus-ring-modality.test.ts -- the keyboard's ring is drawn only once the
 * keyboard has moved focus (`keyboard-modality.ts`): a control the app
 * focuses for itself, a page's Back or a list's current row on mount, or one
 * a press focused, wears none, however the engine's `:focus-visible` guesses.
 * jsdom never matches `:focus-visible`, so the sheets are laid with it read
 * as `:focus`, which is what the engine answers for a focus the app moved
 * itself before any key: the case that rang.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  delete document.documentElement.dataset.keyboard;
  document.body.replaceChildren();
});

/** The panel's sheets, `:focus-visible` read as `:focus`. */
function laySheets(): void {
  laid = layContainersAt({});
  laid.textContent = (laid.textContent ?? "").replaceAll(":focus-visible", ":focus");
}

/** The outline `control` draws once focused. */
function focusedOutline(control: HTMLElement): string {
  document.body.append(control);
  control.focus();
  assert.equal(document.activeElement, control);
  // Note that jsdom resolves a `var()` in the shorthand alone, so the shorthand is read.
  return getComputedStyle(control).getPropertyValue("outline");
}

/** A tabbable element of `role`, or of none. */
function tabbable(role?: string): HTMLElement {
  const element = document.createElement("div");
  element.tabIndex = 0;
  if (role !== undefined) element.setAttribute("role", role);
  return element;
}

/** One of each kind of control the ring is drawn for, by name. */
const CONTROLS: Record<string, () => HTMLElement> = {
  button: () => document.createElement("button"),
  "tabbable row": () => tabbable(),
  tab: () => tabbable("tab"),
};

test("a control focused without the keyboard wears no ring", () => {
  laySheets();
  for (const [name, make] of Object.entries(CONTROLS)) {
    assert.equal(focusedOutline(make()), "none", name);
  }
});

test("a control the keyboard focused wears the ring", () => {
  laySheets();
  document.documentElement.dataset.keyboard = "true";
  for (const [name, make] of Object.entries(CONTROLS)) {
    assert.match(focusedOutline(make()), /\bsolid\b/, name);
  }
});
