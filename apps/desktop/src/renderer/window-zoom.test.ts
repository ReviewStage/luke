// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ZoomPercent } from "@sidecar/settings";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useAppKeymap } from "./app-commands";
import { useWindowZoom } from "./window-zoom";

/**
 * The one stored size, as main holds it: a key's write lands here, and the
 * window is drawn again from it, as the next settings snapshot would draw it.
 * Settings' pop-up writes the same field, which a case stands in for by
 * storing a size itself.
 */
let stored: ZoomPercent = 100;
/** Whether the store refuses a write, as a disk that cannot be written does. */
let refusing = false;
let root: Root | undefined;

function Window({ zoom }: { zoom: ZoomPercent }): null {
  useAppKeymap(true);
  useWindowZoom(zoom, (next): Promise<ActionResult> => {
    if (refusing) {
      return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "No room." });
    }
    stored = next;
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });
  return null;
}

function draw(): void {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Window, { zoom: stored }));
  });
}

/** Presses a Command chord, answering whether the window claimed it, and draws what it stored. */
function press(key: string, shift = false): boolean {
  const claimed = pressOnly(key, shift);
  draw();
  return claimed;
}

/** Presses a Command chord before the settings it wrote have come back. */
function pressOnly(key: string, shift = false): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    shiftKey: shift,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function drawnZoom(): string {
  return document.documentElement.style.getPropertyValue("--zoom");
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  stored = 100;
  refusing = false;
  document.body.innerHTML = "";
});

test("⌘= and ⇧⌘= zoom in, ⌘− zooms out, and ⌘0 returns to actual size, each a write of the stored size", () => {
  draw();
  assert.equal(press("="), true);
  assert.equal(stored, 110);
  // A US keyboard's ⌘+ is Shift and the same key.
  assert.equal(press("+", true), true);
  assert.equal(stored, 125);
  assert.equal(drawnZoom(), "1.25");
  assert.equal(press("-"), true);
  assert.equal(stored, 110);
  assert.equal(press("0"), true);
  assert.equal(stored, 100);
  assert.equal(drawnZoom(), "1");
});

test("a size picked in Settings is the one the next press steps from", () => {
  stored = 175;
  draw();
  assert.equal(drawnZoom(), "1.75");
  press("=");
  assert.equal(stored, 200);
  stored = 75;
  draw();
  press("-");
  assert.equal(stored, 67);
});

test("a press past the largest or smallest size, or ⌘0 at actual size, is left to whatever else wants it", () => {
  stored = 200;
  draw();
  assert.equal(press("="), false);
  assert.equal(stored, 200);
  stored = 67;
  draw();
  assert.equal(press("-"), false);
  assert.equal(stored, 67);
  stored = 100;
  draw();
  assert.equal(press("0"), false);
  assert.equal(stored, 100);
});

test("two presses before the first one's write comes back are two steps", () => {
  draw();
  pressOnly("=");
  pressOnly("=");
  assert.equal(stored, 125);
  draw();
  pressOnly("-");
  pressOnly("-");
  pressOnly("-");
  assert.equal(stored, 90);
});

test("a size the store refused is not the one the next press steps from", async () => {
  draw();
  refusing = true;
  pressOnly("=");
  // The refusal's answer lands a turn later.
  await act(async () => {
    await Promise.resolve();
  });
  refusing = false;
  press("=");
  assert.equal(stored, 110);
});
