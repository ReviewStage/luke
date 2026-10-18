// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Pagination, type PaginationStep } from "./pagination.js";

/**
 * pagination.test.ts -- the steps are links named for where they go and a
 * step with nowhere to go is not read at all; the current page is held, not
 * linked, and announced as current; every page shows while they fit, and the
 * far ones elide once they don't; one page draws no pagination; and steps
 * without numbers carry their words beside the arrow. Synthetic addresses.
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

/** The address of page `page`. */
function pageHref(page: number): string {
  return `/notes/page/${page}`;
}

/** Draws page `current` of `count` with its two steps and hands its container back. */
function drawPages(current: number, count: number): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const step = (page: number, label: string): PaginationStep | undefined =>
    page >= 1 && page <= count ? { href: pageHref(page), label } : undefined;
  act(() =>
    root.render(
      createElement(Pagination, {
        label: "Note pages",
        previous: step(current - 1, "Newer page"),
        next: step(current + 1, "Older page"),
        pages: { current, count, href: pageHref },
      }),
    ),
  );
  return container;
}

/** What the row reads, item by item, as a reader meets it. */
function items(container: HTMLElement): string[] {
  const nav = container.querySelector("nav");
  return [...(nav?.children ?? [])]
    .filter((item) => item.getAttribute("aria-hidden") !== "true")
    .map((item) => item.getAttribute("aria-label") ?? item.textContent ?? "");
}

test("the steps link to the pages beside this one, named for where they go", () => {
  const container = drawPages(2, 3);
  const steps = [...container.querySelectorAll("a[rel]")];

  expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("Note pages");
  expect(steps.map((step) => step.getAttribute("aria-label"))).toEqual([
    "Newer page",
    "Older page",
  ]);
  expect(steps.map((step) => step.getAttribute("href"))).toEqual([pageHref(1), pageHref(3)]);
  expect(steps.map((step) => step.getAttribute("rel"))).toEqual(["prev", "next"]);
});

test("the current page is held and announced, every other one is a link to its page", () => {
  const container = drawPages(2, 3);
  const current = container.querySelector('[aria-current="page"]');

  expect(current?.textContent).toBe("2");
  expect(current?.tagName).not.toBe("A");
  const numbered = [...container.querySelectorAll("a:not([rel])")];
  expect(numbered.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["1", pageHref(1)],
    ["3", pageHref(3)],
  ]);
});

test("a step with nowhere to go is not read, at either end", () => {
  expect(items(drawPages(1, 3))).toEqual(["1", "2", "3", "Older page"]);
  expect(items(drawPages(3, 3))).toEqual(["Newer page", "1", "2", "3"]);
});

test("every page shows while they fit, and the far ones elide once they don't", () => {
  expect(items(drawPages(3, 5))).toEqual(["Newer page", "1", "2", "3", "4", "5", "Older page"]);
  expect(items(drawPages(1, 21))).toEqual(["1", "2", "…", "21", "Older page"]);
  expect(items(drawPages(10, 21))).toEqual([
    "Newer page",
    "1",
    "…",
    "9",
    "10",
    "11",
    "…",
    "21",
    "Older page",
  ]);
  expect(items(drawPages(21, 21))).toEqual(["Newer page", "1", "…", "20", "21"]);
  expect(items(drawPages(4, 21))).toEqual([
    "Newer page",
    "1",
    "2",
    "3",
    "4",
    "5",
    "…",
    "21",
    "Older page",
  ]);
});

test("a single page draws no pagination", () => {
  expect(drawPages(1, 1).querySelector("nav")).toBeNull();
});

test("steps without numbers carry their words beside the arrow", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(Pagination, {
        label: "Releases",
        previous: { href: "/notes/1.4.0", label: "Newer release, v1.4.0", text: "v1.4.0" },
        next: undefined,
      }),
    ),
  );

  const step = container.querySelector("a[rel='prev']");
  expect(step?.textContent).toBe("← v1.4.0");
  expect(step?.getAttribute("aria-label")).toBe("Newer release, v1.4.0");
  expect(items(container)).toEqual(["Newer release, v1.4.0"]);
});
