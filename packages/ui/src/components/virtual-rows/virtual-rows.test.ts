// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, createRef, type RefObject, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import {
  useVirtualRuns,
  VIRTUAL_ROWS_ANCHOR,
  VirtualRows,
  type VirtualRowsHandle,
  type VirtualRuns,
} from "./virtual-rows.js";

/**
 * virtual-rows.test.ts -- a run of rows is a list to a reader, and each row
 * drawn says how many rows the run holds and where it stands among them,
 * though the rows far from the view are not drawn at all; and a run read
 * from its top draws the rows its scroller shows, wherever in the scroller
 * the boxes around it place it, by the sizes it measured when it was last
 * drawn where it is handed them. A run anchored to its end, drawn before its
 * scroller is laid out, opens at its end once the scroller is. A list of
 * several runs answers every row's key, in the order its runs stand.
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
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
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
    if (this.classList.contains("ui-virtual-rows")) return box("body");
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
  // Note that the scroller stands before the run is drawn in it, as a list's does when it is narrowed to another scope.
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

test("a run drawn again with what it measured lays its rows out by those sizes from its first draw", () => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
  // Note that the run stands at the top of a body 1,000px down its scroller, scrolled 2,000px down, as above: by the
  // 100px estimate rows 10 to 17 would show, but its first 20 rows measured 50px, so 1,000px into the run is row 20.
  const box = (id: string) => document.getElementById(id);
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("ui-virtual-rows")) return box("body");
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
  const measurements = keys.slice(0, 20).map((key, index) => ({
    key,
    index,
    start: index * 50,
    end: (index + 1) * 50,
    size: 50,
    lane: 0,
  }));
  const scroller = createRef<HTMLDivElement>();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  // Note that the scroller stands before the run is drawn in it, as a page's does when its rows are drawn again.
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
                measurements,
                children: (index, place) => createElement("li", place, keys[index]),
              })
            : null,
        ),
      ),
    );
  act(() => root.render(frame(false)));
  act(() => root.render(frame(true)));
  const drawn = [...container.querySelectorAll("li")].map((row) => row.textContent);
  assert.equal(drawn[0], "row-16");
  assert.equal(drawn.at(-1), "row-31");
});

test("a row moved to another place, the run's length unchanged, is drawn under its own key", () => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
  const scroller = createRef<HTMLDivElement>();
  const handle = createRef<VirtualRowsHandle>();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const frame = (keys: readonly string[]) =>
    createElement(
      "div",
      { ref: scroller },
      createElement(VirtualRows, {
        scroller,
        keys,
        estimate: 100,
        handle,
        children: (index: number) => createElement("p", null, keys[index]),
      }),
    );
  act(() => root.render(frame(["a", "b", "c", "d"])));
  // Note that the thread that moved to the top of an Inbox is one row taken from the foot, so the run holds as many rows as before.
  act(() => root.render(frame(["d", "a", "b", "c"])));
  const drawn = [...container.querySelectorAll("p")].map((row) => row.textContent);
  assert.deepEqual(drawn, ["d", "a", "b", "c"]);
  assert.deepEqual(handle.current?.drawnKeys(), drawn);
});

test("a run anchored to its end, first drawn in a scroller not laid out, opens at its end once it is", () => {
  // Note that a scroller in a pane not shown yet is no size and scrolls nowhere, as the browser lays it out; shown, it is 600px tall over the 50,000px its 500 rows of 100px stand in.
  const heard: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly #hear: ResizeObserverCallback;
      constructor(hear: ResizeObserverCallback) {
        this.#hear = hear;
      }
      observe(): void {
        heard.push(this.#hear);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  let shown = false;
  let top = 0;
  const isScroller = (element: Element) => element.id === "scroller";
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) && shown ? 600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isScroller(this) && shown ? 50_000 : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return isScroller(this) ? top : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    to: number,
  ) {
    if (!isScroller(this) || to === top) return;
    top = to;
    this.dispatchEvent(new Event("scroll"));
  });
  // jsdom has no `scrollTo` on an element, which the virtualizer writes through.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options?: ScrollToOptions) {
      if (options?.top !== undefined) this.scrollTop = options.top;
    },
  });
  const keys = Array.from({ length: 500 }, (_, index) => `row-${index}`);
  const scroller = createRef<HTMLDivElement>();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        { id: "scroller", ref: scroller },
        createElement(VirtualRows, {
          scroller,
          keys,
          estimate: 100,
          children: (index: number) => createElement("p", null, keys[index]),
        }),
      ),
    ),
  );
  shown = true;
  act(() => {
    for (const hear of heard) hear([], {} as ResizeObserver);
  });
  assert.equal(top, 49_400);
});

test("a list's runs answer every row's key, those left undrawn among them, in the order the runs stand", () => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
  const scroller = createRef<HTMLDivElement>();
  const held: { runs?: VirtualRuns } = {};
  const keysOf = (name: string) => Array.from({ length: 200 }, (_, index) => `${name}-${index}`);
  function Run({ name, runs }: { name: string; runs: VirtualRuns }) {
    const handle = useRef<VirtualRowsHandle>(null);
    useLayoutEffect(() => runs.hold(handle), [runs]);
    const keys = keysOf(name);
    return createElement(VirtualRows, {
      scroller: scroller as RefObject<HTMLElement | null>,
      keys,
      estimate: 100,
      anchor: VIRTUAL_ROWS_ANCHOR.START,
      listItems: true,
      handle,
      children: (index, place) => createElement("li", place, keys[index]),
    });
  }
  function List({ above }: { above: boolean }) {
    const runs = useVirtualRuns();
    held.runs = runs;
    return createElement(
      "div",
      { ref: scroller },
      above ? createElement(Run, { key: "a", name: "a", runs }) : null,
      createElement(Run, { key: "b", name: "b", runs }),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  // Note that the run standing first is drawn last, so it is held after the one below it.
  act(() => root.render(createElement(List, { above: false })));
  act(() => root.render(createElement(List, { above: true })));
  assert.deepEqual(held.runs?.keys(), [...keysOf("a"), ...keysOf("b")]);
});
