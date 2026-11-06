// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useStageRoom } from "./stage-room.js";
import { relayout } from "./testing/resize-observer.js";

let root: Root | undefined;

let stageWidth = 0;
let stageHeight = 0;

let reading: { room: string; compact: boolean } | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  reading = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function Stage(): React.JSX.Element {
  const stage = useStageRoom();
  reading = { room: stage.room, compact: stage.compact };
  return createElement("div", { ref: stage.ref, className: "app-stage" });
}

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

function onTouchScreen(): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query === "(pointer: coarse)",
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

function onScreen(screen: { width: number; height: number }): void {
  vi.spyOn(window.screen, "width", "get").mockReturnValue(screen.width);
  vi.spyOn(window.screen, "height", "get").mockReturnValue(screen.height);
}

const PHONE_SCREEN = { width: 390, height: 844 };
const LANDSCAPE_PHONE = { width: 750, height: 340 };

const TABLET_SCREEN = { width: 1180, height: 820 };

test("a phone on its side, a phone's screen under a finger, stands as one pane", () => {
  onTouchScreen();
  onScreen(PHONE_SCREEN);
  mount(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
  assert.equal(reading?.room, "narrow");
});

test("the same stage under a mouse keeps its panes side by side", () => {
  onScreen(PHONE_SCREEN);
  mount(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
  assert.equal(reading?.room, "wide");
});

test("a phone's screen turns narrow when its main pointer becomes a finger, with no resize", () => {
  onScreen(PHONE_SCREEN);
  let coarse = false;
  const heard = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(
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

test("a tablet's stage that the on-screen keyboard shortens stays wide, however the keyboard shortens it", () => {
  onTouchScreen();
  onScreen(TABLET_SCREEN);
  mount(1180, 740);
  assert.equal(reading?.room, "wide");

  assert.equal(resizeTo(1180, 320)?.room, "wide", "the keyboard makes no tablet a phone");
  assert.equal(resizeTo(1180, 740)?.room, "wide");
});
