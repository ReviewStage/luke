// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { ShowMoreRow } from "./show-more-row.js";

/**
 * show-more-row.test.ts -- a capped list's foot says how many rows it
 * leaves out, shows them on its press and then offers to put them back,
 * and a list whose rows all fit has no foot. Synthetic tasks.
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

const CAP = 3;

/** A list of `count` tasks capped at three rows, ending in its foot. */
function CappedList({ count }: { count: number }): React.JSX.Element {
  const [shown, setShown] = useState(false);
  const tasks = Array.from({ length: count }, (_, index) => `Task ${index + 1}`);
  const drawn = shown ? tasks : tasks.slice(0, CAP);
  return createElement(
    "div",
    null,
    createElement(
      "ul",
      { id: "tasks" },
      drawn.map((task) => createElement("li", { key: task }, task)),
    ),
    createElement(ShowMoreRow, {
      more: count - CAP,
      shown,
      onToggle: () => setShown((was) => !was),
      controls: "tasks",
    }),
  );
}

function draw(count: number): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(CappedList, { count })));
}

function foot(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("button");
}

function rows(): number {
  return document.querySelectorAll("li").length;
}

test("the foot says how many rows the cap leaves out, and shows them on its press", () => {
  draw(8);
  expect(rows()).toBe(3);
  expect(foot()?.textContent).toBe("Show 5 more");
  expect(foot()?.getAttribute("aria-expanded")).toBe("false");
  expect(foot()?.getAttribute("aria-controls")).toBe("tasks");
  act(() => foot()?.click());
  expect(rows()).toBe(8);
  expect(foot()?.textContent).toBe("Show less");
  expect(foot()?.getAttribute("aria-expanded")).toBe("true");
});

test("Show less puts the rows back", () => {
  draw(8);
  act(() => foot()?.click());
  act(() => foot()?.click());
  expect(rows()).toBe(3);
  expect(foot()?.textContent).toBe("Show 5 more");
});

test("a count past a thousand is said with its separator", () => {
  draw(1_203);
  expect(foot()?.textContent).toBe("Show 1,200 more");
});

test("a list whose rows all fit under the cap has no foot", () => {
  draw(3);
  expect(rows()).toBe(3);
  expect(foot()).toBeNull();
});
