// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { type RowMove, useRowDrag } from "./use-row-drag";

/**
 * use-row-drag.test.ts -- a row pressed and drawn far enough up or down its
 * list is dropped where its leading edge crossed the rows' middles, a press
 * that stays a click moves nothing, and Escape puts a drag back. jsdom lays
 * nothing out, so each row is laid out here, a fixed height apart. Synthetic
 * throughout.
 */

/** Each row's height, as laid out here, in CSS pixels. */
const ROW_HEIGHT = 30;

const roots: Root[] = [];

afterEach(() => {
  scrolled = 0;
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** How far the sidebar holding the list has scrolled, in CSS pixels, which moves every box up the screen. */
let scrolled = 0;

/** A list of `count` rows whose drag reports each move to `onMove`, laid out a row's height apart. */
function drawn(count: number, onMove: RowMove): HTMLElement {
  function List() {
    const drag = useRowDrag(onMove);
    return createElement(
      "ul",
      { onPointerDown: drag },
      Array.from({ length: count }, (_, at) =>
        createElement("li", { key: at }, createElement("button", { type: "button" }, `Row ${at}`)),
      ),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(List)));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches("ul")) return DOMRect.fromRect({ y: -scrolled, width: 200 });
    const list = this.parentElement;
    if (!this.matches("li") || list === null) return DOMRect.fromRect();
    const at = [...list.children].indexOf(this);
    return DOMRect.fromRect({ y: at * ROW_HEIGHT - scrolled, width: 200, height: ROW_HEIGHT });
  });
  const list = container.querySelector("ul") ?? assert.fail("the list stands");
  // jsdom captures no pointer; the drag asks the list to, as the window's would.
  Object.assign(list, { setPointerCapture: () => undefined });
  return list;
}

const at = (type: string, y: number) =>
  new PointerEvent(type, { bubbles: true, button: 0, clientY: y, pointerId: 1 });

/** The button on the row at `index`, which a press lands on. */
function grip(list: HTMLElement, index: number): HTMLElement {
  return list.querySelectorAll<HTMLElement>("li button")[index] ?? assert.fail("no such row");
}

test("a row dragged past the middles of the rows below it lands after them", () => {
  const moves: [number, number][] = [];
  const list = drawn(4, (from, to) => moves.push([from, to]));
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 40));
    window.dispatchEvent(at("pointermove", 72));
    window.dispatchEvent(at("pointerup", 72));
  });
  assert.deepEqual(moves, [[0, 2]]);
});

test("a row dragged up past the top of the list lands first", () => {
  const moves: [number, number][] = [];
  const list = drawn(4, (from, to) => moves.push([from, to]));
  act(() => {
    grip(list, 3).dispatchEvent(at("pointerdown", 100));
    window.dispatchEvent(at("pointermove", 20));
    window.dispatchEvent(at("pointermove", -200));
    window.dispatchEvent(at("pointerup", -200));
  });
  assert.deepEqual(moves, [[3, 0]]);
});

test("a press that stays a click moves nothing, and Escape puts a drag back", () => {
  const moves: [number, number][] = [];
  const list = drawn(3, (from, to) => moves.push([from, to]));
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 12));
    window.dispatchEvent(at("pointerup", 12));
  });
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 80));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(at("pointerup", 80));
  });
  assert.deepEqual(moves, []);
  assert.equal(list.getAttribute("data-dragging"), null);
});

test("a row held still while the sidebar scrolls beneath it lands where the scroll carried it", () => {
  const moves: [number, number][] = [];
  const list = drawn(4, (from, to) => moves.push([from, to]));
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 40));
    scrolled = 60;
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(at("pointerup", 40));
  });
  assert.deepEqual(moves, [[0, 3]]);
});

/** Lays out every element wearing `data-box="top height"` there, 200 wide, and every other nowhere. */
function layOutByBoxes(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const box = this.getAttribute("data-box");
    if (box === null) return DOMRect.fromRect();
    const [top = 0, height = 0] = box.split(" ").map(Number);
    return DOMRect.fromRect({ y: top, width: 200, height });
  });
}

/**
 * Two zones down a column: `a`, whose list of two rows is dragged, from 0
 * to 60, and `b`, from 100 to 190, whose three rows keep an order, at 100,
 * 130, and 160. Each drop out of `a` is reported to `outs`. Where `scoped`,
 * `b` stands in a drop scope of its own.
 */
function twoZones(
  outs: [number, string, number][],
  reorders: boolean,
  scoped = false,
): HTMLElement {
  function Column() {
    const drag = useRowDrag(reorders ? () => undefined : undefined, {
      onDropOut: (from, zone, at) => outs.push([from, zone, at]),
    });
    const row = (top: number, name: string) =>
      createElement(
        "li",
        { key: name, "data-box": `${top} 30` },
        createElement("button", { type: "button" }, name),
      );
    return createElement(
      "div",
      null,
      createElement(
        "nav",
        { "data-row-drop": "a", "data-box": "0 60" },
        createElement("ul", { onPointerDown: drag, "data-box": "0 60" }, [
          row(0, "a0"),
          row(30, "a1"),
        ]),
      ),
      createElement(
        "div",
        scoped ? { "data-row-drop-scope": "" } : null,
        createElement(
          "nav",
          { "data-row-drop": "b", "data-box": "100 90" },
          createElement("ul", { "data-row-drop-rows": "", "data-box": "100 90" }, [
            row(100, "b0"),
            row(130, "b1"),
            row(160, "b2"),
          ]),
        ),
      ),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Column)));
  layOutByBoxes();
  const list = container.querySelector("ul") ?? assert.fail("the list stands");
  Object.assign(list, { setPointerCapture: () => undefined });
  return container;
}

/** The button named `name`, which a press lands on. */
function named(container: HTMLElement, name: string): HTMLElement {
  return (
    [...container.querySelectorAll<HTMLElement>("button")].find(
      (each) => each.textContent === name,
    ) ?? assert.fail(`no ${name}`)
  );
}

test("a row carried over another zone lands at the place among its rows the pointer is past, marked while it is carried", () => {
  const outs: [number, string, number][] = [];
  const column = twoZones(outs, true);
  let marked: string | null | undefined;
  act(() => {
    named(column, "a0").dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 80));
    window.dispatchEvent(at("pointermove", 140));
    marked = named(column, "b1").closest("li")?.getAttribute("data-drop-before");
    window.dispatchEvent(at("pointerup", 140));
  });
  assert.equal(marked, "true");
  assert.deepEqual(outs, [[0, "b", 1]]);
  assert.equal(column.querySelector("[data-drop-target], [data-drop-before]"), null);
});

test("a row carried past a zone's last row lands below them all, and one let go over its own list moves out nowhere", () => {
  const outs: [number, string, number][] = [];
  const column = twoZones(outs, true);
  act(() => {
    named(column, "a1").dispatchEvent(at("pointerdown", 40));
    window.dispatchEvent(at("pointermove", 185));
    window.dispatchEvent(at("pointerup", 185));
  });
  act(() => {
    named(column, "a1").dispatchEvent(at("pointerdown", 40));
    window.dispatchEvent(at("pointermove", 120));
    window.dispatchEvent(at("pointermove", 20));
    window.dispatchEvent(at("pointerup", 20));
  });
  assert.deepEqual(outs, [[1, "b", 3]]);
});

test("a list that keeps no order of its own lets a row go only out of it", () => {
  const outs: [number, string, number][] = [];
  const column = twoZones(outs, false);
  act(() => {
    named(column, "a1").dispatchEvent(at("pointerdown", 40));
    window.dispatchEvent(at("pointermove", 5));
    window.dispatchEvent(at("pointerup", 5));
  });
  act(() => {
    named(column, "a0").dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 110));
    window.dispatchEvent(at("pointerup", 110));
  });
  assert.deepEqual(outs, [[0, "b", 0]]);
});

test("a zone in a drop scope takes no row from a list outside it, and is never marked for one", () => {
  const outs: [number, string, number][] = [];
  const column = twoZones(outs, false, true);
  let marked = 0;
  act(() => {
    named(column, "a0").dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 140));
    marked = column.querySelectorAll("[data-drop-target], [data-drop-before]").length;
    window.dispatchEvent(at("pointerup", 140));
  });
  assert.equal(marked, 0);
  assert.deepEqual(outs, []);
});

test("a list dragged by a handle starts no drag from a press outside it", () => {
  const moves: [number, number][] = [];
  function Groups() {
    const drag = useRowDrag((from, to) => moves.push([from, to]), { handle: "h2" });
    return createElement(
      "ul",
      { onPointerDown: drag },
      [0, 1, 2].map((n) =>
        createElement(
          "li",
          { key: n },
          createElement("h2", null, createElement("button", { type: "button" }, `Head ${n}`)),
          createElement("button", { type: "button" }, `Inside ${n}`),
        ),
      ),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Groups)));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (!this.matches("li") || this.parentElement === null) return DOMRect.fromRect();
    const index = [...this.parentElement.children].indexOf(this);
    return DOMRect.fromRect({ y: index * ROW_HEIGHT, width: 200, height: ROW_HEIGHT });
  });
  const list = container.querySelector("ul") ?? assert.fail("the list stands");
  Object.assign(list, { setPointerCapture: () => undefined });
  act(() => {
    named(container, "Inside 0").dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 72));
    window.dispatchEvent(at("pointerup", 72));
  });
  act(() => {
    named(container, "Head 0").dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 72));
    window.dispatchEvent(at("pointerup", 72));
  });
  assert.deepEqual(moves, [[0, 2]]);
});
