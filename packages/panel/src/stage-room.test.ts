// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useStageRoom } from "./stage-room.js";
import { relayout } from "./testing/resize-observer.js";

/**
 * stage-room.test.ts -- the panel's root reads only which lines the stage's
 * width stands past: the room, narrow below 640 until 672, and the sidebar's
 * fold, compact below 1120 until 1160. A stage dragged within a band hands
 * the root the same reading; crossing a line changes it.
 */

let root: Root | undefined;

/** How wide the stage is laid out, which jsdom, laying out nothing, leaves to the test. */
let stageWidth = 0;

/** What the root last read off its stage. */
let reading: { room: string; compact: boolean } | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  reading = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** A root that reads its stage as the panel's does, and draws what it read. */
function Stage(): React.JSX.Element {
  const stage = useStageRoom();
  reading = { room: stage.room, compact: stage.compact };
  return createElement("div", { ref: stage.ref, className: "app-stage" });
}

/** Mounts the root on a stage of a width. */
function mount(width: number): void {
  stageWidth = width;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("app-stage") ? stageWidth : 0 });
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Stage)));
}

/** Resizes the stage, as a window dragged does, and answers what the root reads then. */
function resizeTo(width: number) {
  stageWidth = width;
  act(() => relayout());
  return reading;
}

const WIDE_PINNED = { room: "wide", compact: false };
const WIDE_COMPACT = { room: "wide", compact: true };
const NARROW = { room: "narrow", compact: true };

test("a stage not yet laid out reads wide, with the sidebar pinned", () => {
  mount(0);
  assert.deepEqual(reading, WIDE_PINNED);
});

test("the first measure lands before anything is read at the wrong width: a phone's stage reads narrow at once", () => {
  mount(390);
  assert.deepEqual(reading, NARROW);
});

test("dragging the stage within a band hands the root the same reading, and only crossing a line changes it", () => {
  mount(1280);
  assert.deepEqual(reading, WIDE_PINNED);

  for (const width of [1279, 1250, 1200, 1121, 1120]) {
    assert.deepEqual(resizeTo(width), WIDE_PINNED, `${width} is still pinned`);
  }
  assert.deepEqual(resizeTo(1119), WIDE_COMPACT, "below 1120 the sidebar folds");
  for (const width of [1130, 1159, 900, 641, 640]) {
    assert.deepEqual(resizeTo(width), WIDE_COMPACT, `${width} is still wide and folded`);
  }
  assert.deepEqual(resizeTo(639), NARROW, "below 640 the room is narrow");
  for (const width of [390, 650, 671]) {
    assert.deepEqual(resizeTo(width), NARROW, `${width} is still narrow`);
  }
  assert.deepEqual(resizeTo(672), WIDE_COMPACT, "only at 672 is the room wide again");
  assert.deepEqual(resizeTo(1160), WIDE_PINNED, "only at 1160 is the sidebar pinned again");
});

test("a stage that measures nothing keeps the reading it had", () => {
  mount(390);
  assert.deepEqual(resizeTo(0), NARROW);
});
