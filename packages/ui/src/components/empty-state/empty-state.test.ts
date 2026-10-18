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
 * heading nor a button; a way on unavailable for now stands and takes no
 * press; a place a failure left empty is one alert holding its line and its
 * way on, and an empty one is no alert.
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
function draw(props: {
  title?: string;
  action?: EmptyStateAction;
  alert?: boolean;
  children: string;
}): HTMLElement {
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

test("a way on unavailable for now still stands, and a press does nothing", () => {
  const pressed: string[] = [];
  const container = draw({
    action: { label: "New issue", disabled: true, onClick: () => pressed.push("new") },
    children: "No issues yet",
  });
  const button = container.querySelector("button");
  expect(button?.textContent).toBe("New issue");
  expect(button?.disabled).toBe(true);
  act(() => button?.click());
  expect(pressed).toEqual([]);
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

test("a place a failure left empty is one alert, its way on a press within it", () => {
  const pressed: string[] = [];
  const container = draw({
    alert: true,
    action: {
      label: "Retry",
      icon: createElement(SearchIcon),
      onClick: () => pressed.push("retry"),
    },
    children: "The changes could not be read.",
  });
  const alerts = container.querySelectorAll("[role='alert']");
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toBe("The changes could not be read.Retry");
  const retry = alerts[0]?.querySelector("button");
  expect(retry?.textContent).toBe("Retry");
  act(() => retry?.click());
  expect(pressed).toEqual(["retry"]);
});

test("an empty place no failure left is no alert", () => {
  const container = draw({ children: "No agents at work" });
  expect(container.querySelector("[role='alert']")).toBeNull();
});
