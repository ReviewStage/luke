// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { COARSE_POINTER } from "../coarse-pointer.js";
import { openingView } from "./opening-view.js";

/**
 * opening-view.test.ts -- a board worked by a finger opens in the hand, so a
 * finger dragged across it pans; one worked by a mouse opens on Excalidraw's
 * own selection, as it always has. Both open transparent over the panel.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The device's main pointer: a finger's coarse one, or a mouse's fine one. */
function pointer(coarse: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === COARSE_POINTER,
  }));
}

test("worked by a finger, the board opens in the hand, so a finger's drag pans the view", () => {
  pointer(true);
  const view = openingView();
  assert.equal(view.activeTool?.type, "hand");
  assert.equal(view.viewBackgroundColor, "transparent");
});

test("worked by a mouse, the board opens on Excalidraw's own tool, the selection", () => {
  pointer(false);
  const view = openingView();
  assert.equal(view.activeTool, undefined);
  assert.equal(view.viewBackgroundColor, "transparent");
});
