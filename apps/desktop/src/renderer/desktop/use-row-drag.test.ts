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
