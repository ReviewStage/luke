// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { BarItem } from "./bar-item.js";

/**
 * bar-item.test.ts -- a bar item is a button named by its words; the place
 * shown is announced as the page; one that opens something says whether it
 * stands open; a press and a pointer's press reach the caller; an inert
 * one is inert; and a count is drawn and said with its name, and stands
 * nowhere at none.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function mount(element: React.ReactElement): HTMLButtonElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const found = container.querySelector("button");
  if (found === null) throw new Error("no button drawn");
  return found;
}

test("an item is a button named by its words, its glyph hidden", () => {
  const button = mount(
    createElement(BarItem, { icon: createElement("svg"), onPress: () => {}, children: "Inbox" }),
  );

  expect(button.textContent).toBe("Inbox");
  expect(button.querySelector("[aria-hidden='true']")?.querySelector("svg")).not.toBeNull();
});

test("the place shown is announced as the page, the rest are not", () => {
  const shown = mount(
    createElement(BarItem, { icon: null, current: true, onPress: () => {}, children: "Tasks" }),
  );
  expect(shown.getAttribute("aria-current")).toBe("page");
  const other = mount(createElement(BarItem, { icon: null, onPress: () => {}, children: "Board" }));
  expect(other.hasAttribute("aria-current")).toBe(false);
});

test("an item that opens something says whether it stands open", () => {
  const button = mount(
    createElement(BarItem, { icon: null, expanded: true, onPress: () => {}, children: "More" }),
  );
  expect(button.getAttribute("aria-expanded")).toBe("true");
});

test("a press and a pointer's press reach the caller", () => {
  const onPress = vi.fn();
  const onPointerDown = vi.fn();
  const button = mount(
    createElement(BarItem, { icon: null, onPress, onPointerDown, children: "More" }),
  );
  act(() => {
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    button.click();
  });
  expect(onPointerDown).toHaveBeenCalledTimes(1);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("an inert item is inert", () => {
  const button = mount(
    createElement(BarItem, { icon: null, inert: true, onPress: () => {}, children: "Inbox" }),
  );
  expect(button.hasAttribute("inert")).toBe(true);
});

/** What a reader hears an item named: its words, less what is drawn for the eye alone. */
function spokenName(button: HTMLButtonElement): string {
  const heard = button.cloneNode(true) as HTMLElement;
  for (const unheard of heard.querySelectorAll("[aria-hidden='true']")) unheard.remove();
  return heard.textContent ?? "";
}

test("a count is drawn on the glyph and said after the name with its noun, and stands nowhere at none", () => {
  const counted = mount(
    createElement(BarItem, {
      icon: null,
      count: { value: 3, noun: "need you" },
      onPress: () => {},
      children: "Inbox",
    }),
  );
  expect(spokenName(counted)).toBe("Inbox, 3 need you");
  expect(counted.querySelector("[aria-hidden='true']")?.textContent).toBe("3");

  const none = mount(
    createElement(BarItem, {
      icon: null,
      count: { value: 0, noun: "need you" },
      onPress: () => {},
      children: "Board",
    }),
  );
  expect(spokenName(none)).toBe("Board");
  expect(none.textContent).toBe("Board");
});
