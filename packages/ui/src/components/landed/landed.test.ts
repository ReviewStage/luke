// @vitest-environment jsdom

import { afterEach, expect, test } from "vitest";
import { LANDED, LANDED_ANIMATION, land } from "./landed.js";

afterEach(() => {
  document.body.replaceChildren();
});

function ended(target: Element, name: string): void {
  const end = new Event("animationend", { bubbles: true });
  Object.defineProperty(end, "animationName", { value: name });
  target.dispatchEvent(end);
}

test("a place landed on stays lit until its own light ends", () => {
  const row = document.body.appendChild(document.createElement("div"));
  const words = row.appendChild(document.createElement("span"));
  land(row);
  expect(row.getAttribute("data-landed")).toBe(LANDED.AROUND);

  ended(row, "ui-press-control");
  ended(words, LANDED_ANIMATION);
  expect(row.getAttribute("data-landed")).toBe(LANDED.AROUND);

  ended(row, LANDED_ANIMATION);
  expect(row.hasAttribute("data-landed")).toBe(false);
});

test("a place landed on again while lit is lit afresh, where it is asked", () => {
  const row = document.body.appendChild(document.createElement("div"));
  land(row);
  land(row, LANDED.HELD);
  expect(row.getAttribute("data-landed")).toBe(LANDED.HELD);

  ended(row, LANDED_ANIMATION);
  expect(row.hasAttribute("data-landed")).toBe(false);
});
