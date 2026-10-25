// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { VirtualRows } from "./virtual-rows.js";

/**
 * virtual-rows.test.ts -- a run of rows is a list to a reader, and each row
 * drawn says how many rows the run holds and where it stands among them,
 * though the rows far from the view are not drawn at all.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** Stands in for the browser's ResizeObserver, which jsdom lacks. */
class StandInResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("the rows are the items of a list, each saying the run's size and its own place in it", () => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
  const keys = Array.from({ length: 500 }, (_, index) => `row-${index}`);
  const scroller = createRef<HTMLDivElement>();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        { ref: scroller },
        createElement(VirtualRows, {
          scroller,
          keys,
          estimate: 100,
          children: (index: number) => createElement("p", null, keys[index]),
        }),
      ),
    ),
  );
  const list = container.querySelector('[role="list"]') ?? assert.fail("the run is a list");
  const items = [...list.querySelectorAll<HTMLElement>(':scope > [role="listitem"]')];
  assert.ok(items.length > 0 && items.length < keys.length, "only rows near the view are drawn");
  for (const item of items) {
    const key = item.querySelector("p")?.textContent ?? "";
    assert.equal(item.getAttribute("aria-setsize"), "500");
    assert.equal(item.getAttribute("aria-posinset"), String(keys.indexOf(key) + 1));
  }
});
