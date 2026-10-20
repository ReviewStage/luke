// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useStageRoom } from "./stage-room.js";
import { relayout } from "./testing/resize-observer.js";

/**
 * stage-room.test.ts -- what the panel's root reads off a stage that has not
 * measured a width: wide and pinned before it is laid out, and the last
 * reading once a laid-out stage measures nothing. The lines themselves are
 * walked through the drawn shell (`desktop/shell-room.test.ts`,
 * `desktop/sidebar-collapse.test.ts`).
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
const NARROW = { room: "narrow", compact: true };

test("a stage that has not measured a width reads wide, with the sidebar pinned", () => {
  mount(0);
  assert.deepEqual(reading, WIDE_PINNED);
});

test("a laid-out stage that then measures a zero width keeps the reading it had", () => {
  mount(390);
  assert.deepEqual(resizeTo(0), NARROW);
});
