// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { useDrawerSwipe } from "./use-drawer-swipe.js";

/**
 * drawer-swipe.test.ts -- a finger swiping in from the stage's left edge
 * opens the drawer; one let go short of half way puts it back,
 * unless it was flicked and not held still after; a finger at the screen's
 * very edge, one off the stage, one going up or down first, a mouse, and a stage where the swipe is off open nothing; an
 * open drawer swiped left shuts, and one the system took away stays open;
 * and a claimed swipe's moves and touches reach nothing under the finger.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The drawer's width in the harness, in CSS pixels. */
const DRAWER_WIDTH = 300;

const roots: Root[] = [];

beforeEach(() => {
  // Note that jsdom lays nothing out, so the drawer is given its width and the stage its place at the screen's left.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.dataset.drawer === undefined ? 400 : DRAWER_WIDTH;
    return DOMRect.fromRect({ x: 0, y: 0, width, height: 800 });
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A stage with a drawer at its left edge and a row under the finger, the drawer opening and shutting as the swipe asks. */
function Harness({ enabled, opened }: { enabled: boolean; opened: boolean }): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(opened);
  useDrawerSwipe({
    enabled,
    open,
    stage,
    drawer: () => drawer.current,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  });
  return createElement(
    "div",
    { ref: stage },
    createElement("aside", { ref: drawer, "data-drawer": "", "data-open": String(open) }),
    createElement("div", { "data-row": "" }),
  );
}

function render(enabled = true, opened = false) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Harness, { enabled, opened })));
  const find = (selector: string) => {
    const found = container.querySelector<HTMLElement>(selector);
    assert.ok(found, selector);
    return found;
  };
  return {
    drawer: find("[data-drawer]"),
    row: find("[data-row]"),
  };
}

/** A finger's pointer event at `x`, `y`, stamped `at` milliseconds in, since the swipe reads the finger's speed off the stamps. */
function finger(
  type: string,
  x: number,
  y: number,
  at: number,
  pointerType = "touch",
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 7,
    pointerType,
    isPrimary: true,
  });
  Object.defineProperty(event, "timeStamp", { value: at });
  return event;
}

/** The touch move a finger at `x`, `y` makes beside its pointer move, which the page would scroll by. */
function touchMove(x: number, y: number): Event {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: y }] });
  return event;
}

/** A finger going down on `target` at `from`, moving through `steps` 16ms apart, and lifted or taken away at the last. */
function swipe(
  target: HTMLElement,
  from: readonly [number, number],
  steps: readonly (readonly [number, number])[],
  end: "pointerup" | "pointercancel" = "pointerup",
  stepMs = 16,
  pointerType = "touch",
): void {
  let at = 1;
  act(() => {
    target.dispatchEvent(finger("pointerdown", from[0], from[1], at, pointerType));
  });
  for (const [x, y] of steps) {
    at += stepMs;
    act(() => {
      target.dispatchEvent(finger("pointermove", x, y, at, pointerType));
      target.dispatchEvent(touchMove(x, y));
    });
  }
  const last = steps.at(-1) ?? from;
  act(() => {
    target.dispatchEvent(finger(end, last[0], last[1], at + stepMs, pointerType));
  });
}

test("let go past half way, the drawer opens", () => {
  const { drawer, row } = render();
  swipe(
    row,
    [30, 400],
    [
      [100, 400],
      [200, 400],
      [220, 400],
    ],
    "pointerup",
    200,
  );
  assert.equal(drawer.dataset.open, "true");
});

test("let go slowly short of half way, the drawer goes back", () => {
  const { drawer, row } = render();
  swipe(
    row,
    [30, 400],
    [
      [60, 400],
      [100, 400],
    ],
    "pointerup",
    200,
  );
  assert.equal(drawer.dataset.open, "false");
});

test("a short quick flick opens the drawer", () => {
  const { drawer, row } = render();
  swipe(
    row,
    [30, 400],
    [
      [60, 400],
      [100, 400],
    ],
  );
  assert.equal(drawer.dataset.open, "true");
});

test("a short flick held still before the finger lifts goes back", () => {
  const { drawer, row } = render();
  act(() => {
    row.dispatchEvent(finger("pointerdown", 30, 400, 1));
    row.dispatchEvent(finger("pointermove", 60, 400, 9));
    row.dispatchEvent(finger("pointermove", 100, 400, 17));
    row.dispatchEvent(finger("pointerup", 100, 400, 1017));
  });
  assert.equal(drawer.dataset.open, "false");
});

test("a finger going down off the stage opens nothing, however near the edge", () => {
  const { drawer } = render();
  const below = document.body.appendChild(document.createElement("div"));
  swipe(
    below,
    [30, 900],
    [
      [60, 900],
      [200, 900],
    ],
  );
  assert.equal(drawer.dataset.open, "false");
});

test("a finger at the screen's very edge is left to the browser's own back swipe", () => {
  const { drawer, row } = render();
  swipe(
    row,
    [8, 400],
    [
      [60, 400],
      [200, 400],
    ],
  );
  assert.equal(drawer.dataset.open, "false");
});

test("a finger going up or down first is the page's scroll and never the drawer's", () => {
  const { drawer, row } = render();
  const scrolls: boolean[] = [];
  row.addEventListener("touchmove", (event) => scrolls.push(!event.defaultPrevented));
  swipe(
    row,
    [30, 400],
    [
      [34, 380],
      [120, 360],
      [220, 350],
    ],
  );
  assert.equal(drawer.dataset.open, "false");
  assert.deepEqual(scrolls, [true, true, true]);
});

test("a mouse, and a stage where the swipe is off, open nothing", () => {
  const mouse = render();
  swipe(mouse.row, [30, 400], [[200, 400]], "pointerup", 16, "mouse");
  assert.equal(mouse.drawer.dataset.open, "false");
  const off = render(false);
  swipe(off.row, [30, 400], [[200, 400]]);
  assert.equal(off.drawer.dataset.open, "false");
});

test("an open drawer swiped left shuts, and one the system took away stays open", () => {
  const shut = render(true, true);
  swipe(
    shut.drawer,
    [250, 400],
    [
      [200, 400],
      [80, 400],
    ],
  );
  assert.equal(shut.drawer.dataset.open, "false");
  const kept = render(true, true);
  swipe(kept.drawer, [250, 400], [[40, 400]], "pointercancel");
  assert.equal(kept.drawer.dataset.open, "true");
});

test("a claimed swipe's moves and touches reach nothing under the finger", () => {
  const { row } = render();
  const moves: number[] = [];
  const scrolls: boolean[] = [];
  row.addEventListener("pointermove", (event) => moves.push(event.clientX));
  row.addEventListener("touchmove", (event) => scrolls.push(!event.defaultPrevented));
  swipe(
    row,
    [30, 400],
    [
      [80, 400],
      [160, 400],
    ],
  );
  assert.deepEqual(moves, []);
  assert.deepEqual(scrolls, [false, false]);
});
