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

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

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
  act(() => root.render(frame(["d", "a", "b", "c"])));
  const drawn = [...container.querySelectorAll("p")].map((row) => row.textContent);
  assert.deepEqual(drawn, ["d", "a", "b", "c"]);
  assert.deepEqual(handle.current?.drawnKeys(), drawn);
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
  act(() => root.render(createElement(List, { above: false })));
  act(() => root.render(createElement(List, { above: true })));
  assert.deepEqual(held.runs?.keys(), [...keysOf("a"), ...keysOf("b")]);
});
