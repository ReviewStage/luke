// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { VIRTUAL_ROWS_ANCHOR, VirtualRows } from "./virtual-rows.js";

/**
 * virtual-rows.test.ts -- a run of rows is a list to a reader, and each row
 * drawn says how many rows the run holds and where it stands among them,
 * though the rows far from the view are not drawn at all; and a run read
 * from its top draws the rows its scroller shows, wherever in the scroller
 * the boxes around it place it.
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
  vi.restoreAllMocks();
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

test("a run read from its top, placed by a box inside its scroller, draws the rows the scroll shows", () => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
  // Note that jsdom lays nothing out, so the run stands at the top of a list's body that is itself
  // placed 1,000px down the scroller's content, and the scroller is scrolled 2,000px down: rows
  // 10 to 17 of 100px fill the window's 768px, and the four on either side are drawn with them.
  const box = (id: string) => document.getElementById(id);
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("luke-virtual-rows")) return box("body");
    return this.id === "body" || this.id === "scroller" ? box("list") : null;
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.id === "body" ? 1000 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.id === "scroller" ? 2000 : 0;
  });
  const keys = Array.from({ length: 100 }, (_, index) => `row-${index}`);
  const scroller = createRef<HTMLDivElement>();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  // Note that the scroller stands before the run is drawn in it, as a list's does when it is narrowed to another channel.
  const frame = (run: boolean) =>
    createElement(
      "nav",
      { id: "list" },
      createElement(
        "div",
        { id: "scroller", ref: scroller },
        createElement(
          "div",
          { id: "body" },
          run
            ? createElement(VirtualRows, {
                scroller,
                keys,
                estimate: 100,
                anchor: VIRTUAL_ROWS_ANCHOR.START,
                listItems: true,
                children: (index, place) => createElement("li", place, keys[index]),
              })
            : null,
        ),
      ),
    );
  act(() => root.render(frame(false)));
  act(() => root.render(frame(true)));
  const drawn = [...container.querySelectorAll("li")].map((row) => row.textContent);
  assert.equal(drawn[0], "row-6");
  assert.equal(drawn.at(-1), "row-21");
});
