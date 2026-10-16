import assert from "node:assert/strict";
import { test } from "vitest";
import {
  FITTED_VIEW,
  FRAME_CENTRE,
  type FramePoint,
  IMAGE_ZOOM,
  type ImageFrame,
  type ImageView,
  isZoomed,
  pannedBy,
  pressedAt,
  zoomedByStep,
  zoomedByWheel,
  zoomedTo,
} from "./image-zoom.js";

/**
 * image-zoom.test.ts -- a picture opened over the window zooms about the
 * point under the pointer, never moves past its own edges, pinches back to
 * where it began, and a press zooms it to its own pixels and back. A
 * synthetic 800 by 500 frame holding a 2400 by 1200 screenshot fitted to
 * 800 by 400.
 */

const FRAME: ImageFrame = {
  frame: { width: 800, height: 500 },
  fitted: { width: 800, height: 400 },
};

const NATURAL = { width: 2400, height: 1200 };

/** Where the picture's point now under `at` lies on the fitted picture, from its centre. */
function pictureUnder(view: ImageView, at: FramePoint): FramePoint {
  return { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
}

/** Whether two lengths are the same to a hundredth of a pixel. */
function near(first: number, second: number): boolean {
  return Math.abs(first - second) < 0.01;
}

test("a zoom keeps the picture's point under the pointer where it stands", () => {
  const at = { x: 200, y: -100 };
  const zoomed = zoomedTo(FITTED_VIEW, FRAME, 3, at);
  assert.equal(zoomed.scale, 3);
  const before = pictureUnder(FITTED_VIEW, at);
  const after = pictureUnder(zoomed, at);
  assert.ok(near(before.x, after.x) && near(before.y, after.y), "the same point is under it");
  const further = zoomedByWheel(zoomed, FRAME, -20, at);
  assert.ok(further.scale > zoomed.scale, "a pinch apart zooms in");
  const still = pictureUnder(further, at);
  assert.ok(near(before.x, still.x) && near(before.y, still.y), "and keeps it there too");
});

test("a pinch in and out again comes back to the picture fitted", () => {
  const at = { x: -150, y: 60 };
  let view = FITTED_VIEW;
  for (let pinch = 0; pinch < 10; pinch += 1) view = zoomedByWheel(view, FRAME, -12, at);
  assert.ok(isZoomed(view));
  for (let pinch = 0; pinch < 10; pinch += 1) view = zoomedByWheel(view, FRAME, 12, at);
  assert.deepEqual(view, FITTED_VIEW);
});

test("a zoom goes no further out than fitted and no further in than the most", () => {
  assert.deepEqual(zoomedByStep(FITTED_VIEW, FRAME, -1), FITTED_VIEW);
  assert.deepEqual(zoomedByWheel(FITTED_VIEW, FRAME, 500, FRAME_CENTRE), FITTED_VIEW);
  const most = zoomedTo(FITTED_VIEW, FRAME, 100, FRAME_CENTRE);
  assert.equal(most.scale, IMAGE_ZOOM.MOST);
  assert.equal(zoomedByStep(most, FRAME, 1).scale, IMAGE_ZOOM.MOST);
});

test("a mouse wheel's notch zooms by a step, not a leap", () => {
  const notch = zoomedByWheel(FITTED_VIEW, FRAME, -100, FRAME_CENTRE);
  assert.ok(notch.scale > 1 && notch.scale < 2, `one notch zoomed to ${String(notch.scale)}`);
});

test("a zoomed picture moves no further than to bring its edge to the frame's", () => {
  const zoomed = zoomedTo(FITTED_VIEW, FRAME, 2, FRAME_CENTRE);
  const far = pannedBy(zoomed, FRAME, 10_000, -10_000);
  // At twice, the picture is 1600 by 800 in an 800 by 500 frame.
  assert.equal(far.x, 400, "its left edge stands at the frame's left");
  assert.equal(far.y, -150, "its bottom edge stands at the frame's bottom");
  const back = pannedBy(far, FRAME, -10_000, 10_000);
  assert.equal(back.x, -400);
  assert.equal(back.y, 150);
});

test("a picture narrower than its frame along an axis stays centred along it", () => {
  const tall: ImageFrame = {
    frame: { width: 800, height: 500 },
    fitted: { width: 200, height: 500 },
  };
  const zoomed = zoomedTo(FITTED_VIEW, tall, 2, { x: 100, y: 200 });
  assert.equal(zoomed.x, 0, "400 wide in 800 stays centred");
  assert.ok(zoomed.y !== 0, "1000 tall in 500 follows the pointer");
  assert.equal(pannedBy(zoomed, tall, 300, 0).x, 0);
});

test("a fitted picture cannot be moved, nor does a zoom out leave it off centre", () => {
  assert.deepEqual(pannedBy(FITTED_VIEW, FRAME, 50, 50), FITTED_VIEW);
  const zoomed = pannedBy(zoomedTo(FITTED_VIEW, FRAME, 3, FRAME_CENTRE), FRAME, 300, 200);
  let view = zoomed;
  for (let step = 0; step < 4; step += 1) view = zoomedByStep(view, FRAME, -1);
  assert.deepEqual(view, FITTED_VIEW);
});

test("a press zooms a fitted picture to its own pixels there, and a zoomed one back to fitted", () => {
  const at = { x: 100, y: 50 };
  const pressed = pressedAt(FITTED_VIEW, FRAME, NATURAL, at);
  assert.equal(pressed.scale, 3, "2400 pixels drawn 800 wide is a third of its own size");
  const under = pictureUnder(pressed, at);
  assert.ok(
    near(under.x, at.x) && near(under.y, at.y),
    "the point pressed stays under the pointer",
  );
  assert.deepEqual(pressedAt(pressed, FRAME, NATURAL, at), FITTED_VIEW);
});

test("a press on a picture fitted at about its own size still zooms it, to twice", () => {
  const small = { width: 820, height: 410 };
  assert.equal(pressedAt(FITTED_VIEW, FRAME, small, FRAME_CENTRE).scale, IMAGE_ZOOM.PRESS_LEAST);
});
