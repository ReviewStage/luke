// @vitest-environment jsdom

import { afterEach, expect, test } from "vitest";
import { PRESS_PULSE, pulsePress } from "./press-pulse.js";

/**
 * press-pulse.test.ts -- a flush row's pulse moves what it holds and stands
 * until the first of those that draws a box settles, a seat drawn as
 * `contents` passed over, since it draws none whose motion could end; and a
 * flush row holding no element fades instead.
 */

afterEach(() => {
  document.body.replaceChildren();
});

/** A row holding a seat drawn as `contents`, then its words. */
function row(): { row: HTMLElement; seat: HTMLElement; words: HTMLElement } {
  const row = document.body.appendChild(document.createElement("div"));
  const seat = row.appendChild(document.createElement("span"));
  seat.style.display = "contents";
  const words = row.appendChild(document.createElement("span"));
  return { row, seat, words };
}

test("a flush row's pulse stands until the first of what it holds that draws a box settles", () => {
  const { row: pressed, seat, words } = row();
  pulsePress(pressed, PRESS_PULSE.FLUSH);
  expect(pressed.getAttribute("data-pulse")).toBe("flush");

  seat.dispatchEvent(new Event("animationend", { bubbles: true }));
  expect(pressed.getAttribute("data-pulse")).toBe("flush");

  words.dispatchEvent(new Event("animationend", { bubbles: true }));
  expect(pressed.hasAttribute("data-pulse")).toBe(false);
});

test("a flush row that holds only words fades", () => {
  const pressed = document.body.appendChild(document.createElement("div"));
  pressed.textContent = "src/retry.ts L3–9";
  pulsePress(pressed, PRESS_PULSE.FLUSH);
  expect(pressed.getAttribute("data-pulse")).toBe("words");
});
