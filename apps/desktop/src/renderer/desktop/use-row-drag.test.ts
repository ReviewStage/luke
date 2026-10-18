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

test("in a list that reorders, the placeholder slides to where the row would land and the rows it passed stand aside, while the copy follows the pointer", () => {
  const list = drawn(4, () => undefined);
  const shifts: string[] = [];
  let carried: string | undefined;
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 72));
    carried = copyAt();
    for (const row of list.querySelectorAll("li")) shifts.push(row.style.transform);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(carried, "translate(0px, 62px)");
  assert.deepEqual(shifts, ["translateY(60px)", "translateY(-30px)", "translateY(-30px)", ""]);
});

test("a row let go off to the side lands its copy on the row's place on both axes, the row faded beneath it until it does", () => {
  const plays: Keyframe[][] = [];
  let finish: (() => void) | undefined;
  // jsdom plays no animation; the copy's landing is taken as the window would start it.
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(keyframes: Keyframe[]) {
      plays.push(keyframes);
      const played = { onfinish: () => undefined };
      finish = () => played.onfinish();
      return played;
    },
  });
  const moves: [number, number][] = [];
  const list = drawn(4, (from, to) => moves.push([from, to]));
  list.style.setProperty("--duration-fast", "180ms");
  let faded: string | null = null;
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 72,
        pointerId: 1,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 72,
        pointerId: 1,
      }),
    );
    faded = list.querySelector("li")?.getAttribute("data-dragging") ?? null;
  });
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  assert.deepEqual(moves, [[0, 2]]);
  // The list here keeps its rows where they stood, so the row's place is still the first.
  assert.deepEqual(plays, [
    [{ transform: "translate(100px, 62px)" }, { transform: "translate(0px, 0px)" }],
  ]);
  assert.equal(faded, "true");
  assert.notEqual(document.querySelector("[data-carried]"), null, "the copy stands until it lands");
  act(() => finish?.());
  assert.equal(document.querySelector("[data-carried]"), null);
  assert.equal(list.querySelector("li")?.getAttribute("data-dragging"), null);
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

/** Frames asked for, which a test runs by hand. */
let frames: FrameRequestCallback[] = [];

/** Runs the frames asked for, and those they ask for in turn, up to `most` of them. */
function runFrames(most = 50): void {
  for (let run = 0; run < most; run += 1) frames.shift()?.(0);
}

/**
 * Six rows, 180 of them, in a column `height` tall that scrolls them, as far
 * as 180 less its height; each move is reported to `moves`.
 */
function inColumn(height: number, moves: [number, number][]): HTMLElement {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const list = drawn(6, (from, to) => moves.push([from, to]));
  const column = list.parentElement ?? assert.fail("the list stands in a column");
  column.style.overflowY = "auto";
  const most = 6 * ROW_HEIGHT - height;
  Object.defineProperties(column, {
    clientHeight: { value: height },
    scrollHeight: { value: 6 * ROW_HEIGHT },
    scrollTop: {
      get: () => scrolled,
      set: (to: number) => {
        scrolled = Math.max(0, Math.min(most, to));
      },
    },
  });
  const laid = vi.spyOn(Element.prototype, "getBoundingClientRect");
  const rowsLaid = laid.getMockImplementation() ?? assert.fail("the rows are laid out");
  laid.mockImplementation(function (this: Element) {
    return this === column ? DOMRect.fromRect({ width: 200, height }) : rowsLaid.call(this);
  });
  return list;
}

test("a row held at the foot of the column that scrolls its list runs the column down, and lands where that carried it", () => {
  const moves: [number, number][] = [];
  const list = inColumn(100, moves);
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 50));
    runFrames();
  });
  assert.equal(scrolled, 0, "held away from the edges, the column stands still");
  act(() => {
    window.dispatchEvent(at("pointermove", 95));
    runFrames();
    window.dispatchEvent(at("pointerup", 95));
  });
  assert.equal(scrolled, 80);
  assert.deepEqual(moves, [[0, 5]]);
});

test("a row held at the foot of a column that stands around its drop scope rather than within it runs nothing", () => {
  const list = inColumn(100, []);
  list.parentElement?.setAttribute("data-row-drop-scope", "");
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 95));
    runFrames();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(scrolled, 0);
});

test("a column too short for both edges' reach runs only toward the nearer edge, and stands still once it can go no further", () => {
  const moves: [number, number][] = [];
  const list = inColumn(50, moves);
  act(() => {
    grip(list, 0).dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 20));
    runFrames();
  });
  assert.equal(scrolled, 0);
  assert.equal(frames.length, 0, "the column stands still");
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
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
 * Two zones down a column: `a`, from -40 to 60, a header over the list of
 * two rows that is dragged, from 0 to 60, and `b`, from 100 to 190, whose
 * three rows keep an order, at 100, 130, and 160, with a gap between them. Each drop out of `a` is reported to `outs`. Where `scoped`,
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
        { "data-row-drop": "a", "data-box": "-40 100" },
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

/** Where the carried copy is drawn, moved from where it was lifted; none while nothing is carried. */
function copyAt(): string | undefined {
  return document.querySelector<HTMLElement>("[data-carried]")?.style.transform;
}

/** The transform the row named `name` is drawn at. */
function drawnAt(container: HTMLElement, name: string): string | undefined {
  return named(container, name).closest("li")?.style.transform;
}

test("a row of a list that keeps no order is carried as a copy that follows the pointer over its own zone's header, while the row stands home, and lands nowhere there", () => {
  const outs: [number, string, number][] = [];
  const column = twoZones(outs, false);
  let carried: string | undefined;
  let home: string | undefined;
  act(() => {
    named(column, "a1").dispatchEvent(at("pointerdown", 40));
    window.dispatchEvent(at("pointermove", -20));
    carried = copyAt();
    home = drawnAt(column, "a1");
    window.dispatchEvent(at("pointerup", -20));
  });
  assert.equal(carried, "translate(0px, -60px)");
  assert.equal(home, "");
  assert.deepEqual(outs, []);
  assert.equal(document.querySelector("[data-carried]"), null, "the copy comes down with the drop");
});

test("a copy carried into the gap between two zones follows the pointer, every row standing home, and lands nowhere there", () => {
  const outs: [number, string, number][] = [];
  const column = twoZones(outs, true);
  let carried: string | undefined;
  let home: string | undefined;
  let marked = 0;
  act(() => {
    named(column, "a0").dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 80));
    carried = copyAt();
    home = drawnAt(column, "a0");
    marked = column.querySelectorAll("[data-drop-target], [data-drop-before]").length;
    window.dispatchEvent(at("pointerup", 80));
  });
  assert.equal(carried, "translate(0px, 70px)");
  assert.equal(home, "");
  assert.equal(marked, 0);
  assert.deepEqual(outs, []);
});

test("a copy carried far past the foot of the column that scrolls its list stands outside the column, drawn under its scope's classes, and the row never leaves its list", () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  function Column() {
    const drag = useRowDrag(undefined, { onDropOut: () => undefined });
    return createElement(
      "div",
      { className: "scope-look", "data-row-drop-scope": "" },
      createElement(
        "div",
        { style: { overflowY: "auto" }, "data-box": "0 100" },
        createElement(
          "nav",
          { "data-row-drop": "a", "data-box": "0 60" },
          createElement(
            "ul",
            { onPointerDown: drag, "data-box": "0 60" },
            ["a0", "a1"].map((name, index) =>
              createElement(
                "li",
                { key: name, "data-box": `${index * ROW_HEIGHT} ${ROW_HEIGHT}` },
                createElement("button", { type: "button" }, name),
              ),
            ),
          ),
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
  let carried: string | undefined;
  let home: string | undefined;
  let outside = false;
  let looked = false;
  act(() => {
    named(container, "a0").dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 400));
    carried = copyAt();
    home = drawnAt(container, "a0");
    const layer = document.querySelector("[data-carried]");
    outside = layer !== null && !container.contains(layer);
    looked = layer?.querySelector(".scope-look > ul > li[data-lifted]") != null;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(carried, "translate(0px, 390px)");
  assert.equal(home, "");
  assert.ok(outside, "the copy is carried outside the column");
  assert.ok(looked, "the copy is drawn under its scope's classes");
  assert.equal(document.querySelector("[data-carried]"), null, "Escape takes the copy down");
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
