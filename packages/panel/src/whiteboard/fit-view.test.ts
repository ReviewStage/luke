import assert from "node:assert/strict";
import { test } from "vitest";
import { FOLLOW, fitView, followFit, type Rect, type SceneBounds, type View } from "./fit-view.js";

/**
 * fit-view.test.ts -- a board's first view puts the whole drawing between the toolbars floating over the canvas, a gap clear of each, gives up room beside a side tool only where the drawing would reach it, and follows the canvas's size until someone moves it.
 */

const GAP = 16;
const CANVAS = { width: 400, height: 300 };

/** Where the drawing's box lands on the canvas, as Excalidraw maps a scene point: scroll first, then zoom. */
function onScreen(view: View, bounds: SceneBounds): Rect {
  const [left, top, right, bottom] = bounds;
  return {
    left: (left + view.scrollX) * view.zoom,
    top: (top + view.scrollY) * view.zoom,
    right: (right + view.scrollX) * view.zoom,
    bottom: (bottom + view.scrollY) * view.zoom,
  };
}

function assertBox(actual: Rect, expected: Rect): void {
  for (const side of ["left", "top", "right", "bottom"] as const) {
    assert.ok(Math.abs(actual[side] - expected[side]) < 1e-6, `${side}: ${actual[side]}`);
  }
}

test("a diagram wider than the canvas fills its width between the top and bottom toolbars", () => {
  const bounds: SceneBounds = [0, 0, 800, 100];
  const top = { left: 16, top: 16, right: 384, bottom: 60 };
  const bottom = { left: 16, top: 240, right: 384, bottom: 284 };
  const view = fitView(CANVAS, [top, bottom], bounds, GAP);
  // 368px of room across 800 of drawing is 0.46, which stands the 46px height centred between the bars.
  assert.ok(Math.abs(view.zoom - 0.46) < 1e-9);
  assertBox(onScreen(view, bounds), { left: 16, top: 127, right: 384, bottom: 173 });
});

test("a side tool the drawing would reach holds the drawing back from it", () => {
  const bounds: SceneBounds = [0, 0, 320, 200];
  const sideTools = { left: 350, top: 100, right: 400, bottom: 200 };
  const view = fitView(CANVAS, [sideTools], bounds, GAP);
  // Alone the drawing would run to 360; the tools start at 350, so it ends a gap short of them, at 334.
  assertBox(onScreen(view, bounds), { left: 16, top: 50.625, right: 334, bottom: 249.375 });
});

test("a side tool the drawing would stand too near holds it a gap clear, though they do not touch", () => {
  const bounds: SceneBounds = [0, 0, 320, 200];
  const sideTools = { left: 370, top: 100, right: 400, bottom: 200 };
  const view = fitView(CANVAS, [sideTools], bounds, GAP);
  // Alone the drawing would end at 360, 10px short of the tools. The room left of a gap short of them is 338 wide, centred from 16, so it ends at 345.
  assertBox(onScreen(view, bounds), { left: 25, top: 50, right: 345, bottom: 250 });
});

test("a side tool above the drawing takes no room from it", () => {
  const bounds: SceneBounds = [0, 0, 320, 200];
  const sideTools = { left: 370, top: 0, right: 400, bottom: 30 };
  const view = fitView(CANVAS, [sideTools], bounds, GAP);
  assert.equal(view.zoom, 1);
  assertBox(onScreen(view, bounds), { left: 40, top: 50, right: 360, bottom: 250 });
});

test("a fitted view is fitted again when its canvas changes size, until someone moves it", () => {
  // A window opened at 1280 wide and then made 760 wide: the view fitted at the first size no longer fits.
  const view = { zoom: 1, scrollX: 120, scrollY: 80 };
  const fitted = { view, width: 860, height: 700 };
  assert.equal(followFit(fitted, { view, width: 368, height: 464 }), FOLLOW.REFIT);
  assert.equal(followFit(fitted, { view, width: 860, height: 700 }), FOLLOW.HOLD);
  const scrolled = { ...view, scrollY: 40 };
  assert.equal(followFit(fitted, { view: scrolled, width: 368, height: 464 }), FOLLOW.RELEASE);
});
