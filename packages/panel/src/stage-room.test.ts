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
 * reading once a laid-out stage measures nothing; and a phone turned on its
 * side, wide but short under a finger, stands as one pane where the same
 * stage under a mouse stays wide. The width's lines themselves are
 * walked through the drawn shell (`desktop/shell-room.test.ts`,
 * `desktop/sidebar-collapse.test.ts`).
 */

let root: Root | undefined;

/** How wide and tall the stage is laid out, which jsdom, laying out nothing, leaves to the test. */
let stageWidth = 0;
let stageHeight = 0;

/** What the root last read off its stage. */
let reading: { room: string; compact: boolean } | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  reading = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

/** A root that reads its stage as the panel's does, and draws what it read. */
function Stage(): React.JSX.Element {
  const stage = useStageRoom();
  reading = { room: stage.room, compact: stage.compact };
  return createElement("div", { ref: stage.ref, className: "app-stage" });
}

/** Mounts the root on a stage of a width, and of a height where one is given. */
function mount(width: number, height = 0): void {
  stageWidth = width;
  stageHeight = height;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const stage = this.classList.contains("app-stage");
    return DOMRect.fromRect({ width: stage ? stageWidth : 0, height: stage ? stageHeight : 0 });
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Stage)));
}

/** Resizes the stage, as a window dragged or a phone turned does, and answers what the root reads then. */
function resizeTo(width: number, height = stageHeight) {
  stageWidth = width;
  stageHeight = height;
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

/** Answers the device's pointer as a finger's, as a phone's browser does. */
function onTouchScreen(): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    // SAFETY: the room reads `matches` alone, which this answers for every query.
    (query) =>
      ({
        matches: query === "(pointer: coarse)",
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

/** A phone on its side: as wide as a small laptop's tab, a strip tall. */
const LANDSCAPE_PHONE = { width: 750, height: 340 };

test("a phone on its side, a short stage under a finger, stands as one pane", () => {
  onTouchScreen();
  mount(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
  assert.equal(reading?.room, "narrow");
});

test("a stage as short under a mouse keeps its panes side by side", () => {
  mount(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
  assert.equal(reading?.room, "wide");
});

test("a short stage under a finger is wide again only at 532 tall, and narrow again only below 500", () => {
  onTouchScreen();
  mount(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
  assert.equal(resizeTo(750, 520)?.room, "narrow", "a stage grown within the band stays narrow");
  assert.equal(resizeTo(750, 532)?.room, "wide");
  assert.equal(resizeTo(750, 510)?.room, "wide", "a stage shrunk within the band stays wide");
  assert.equal(resizeTo(750, 499)?.room, "narrow");
});

test("a short stage turns narrow when its main pointer becomes a finger, with no resize", () => {
  let coarse = false;
  const heard = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(
    // SAFETY: the room reads `matches` and listens for its change, which this answers.
    (query) =>
      ({
        get matches() {
          return coarse && query === "(pointer: coarse)";
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => heard.add(listener),
        removeEventListener: (_: string, listener: () => void) => heard.delete(listener),
      }) as unknown as MediaQueryList,
  );
  mount(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
  assert.equal(reading?.room, "wide");

  coarse = true;
  act(() => {
    for (const listener of heard) listener();
  });
  assert.equal(reading?.room, "narrow");
});

test("a tall stage under a finger that the on-screen keyboard shortens stays wide, as a tablet's does on every focus", () => {
  onTouchScreen();
  mount(1180, 740);
  assert.equal(reading?.room, "wide");

  document.documentElement.style.setProperty("--luke-keyboard-inset", "420px");
  assert.equal(resizeTo(1180, 320)?.room, "wide", "the keyboard makes no stage short");

  document.documentElement.style.setProperty("--luke-keyboard-inset", "0px");
  assert.equal(resizeTo(1180, 740)?.room, "wide");
});
