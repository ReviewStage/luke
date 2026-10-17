// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SearchIcon } from "../../face/glyphs.js";
import { EmptyState, type EmptyStateAction } from "./empty-state.js";

/**
 * empty-state.test.ts -- an empty place shows its heading and its line, its
 * glyph hidden from a reader; its one way on is a button named by its words
 * that answers a press; and a place with a line alone offers neither a
 * heading nor a button.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINE = "This task doesn't exist, or you don't have access to it.";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws an empty state on the page and hands back what it was drawn into. */
function draw(props: { title?: string; action?: EmptyStateAction; children: string }): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(EmptyState, { icon: createElement(SearchIcon), ...props })));
  return container;
}

test("an empty place shows its heading and line, and its way on answers a press", () => {
  const pressed: string[] = [];
  const container = draw({
    title: "Not found",
    action: { label: "Close task", onClick: () => pressed.push("close") },
    children: LINE,
  });
  const heading = container.querySelector("h1, h2, h3, h4, h5, h6");
  expect(heading?.textContent).toBe("Not found");
  expect(container.textContent).toContain(LINE);
  const buttons = container.querySelectorAll("button");
  expect([...buttons].map((button) => button.textContent)).toEqual(["Close task"]);
  act(() => buttons[0]?.click());
  expect(pressed).toEqual(["close"]);
});

test("the glyph says nothing to a reader", () => {
  const container = draw({ title: "Not found", children: LINE });
  expect(container.querySelector("svg")?.closest("[aria-hidden='true']")).not.toBeNull();
});

test("an empty place with a line alone shows no heading and no button", () => {
  const container = draw({ children: "No agents at work" });
  expect(container.textContent).toBe("No agents at work");
  expect(container.querySelector("h1, h2, h3, h4, h5, h6, button")).toBeNull();
});
