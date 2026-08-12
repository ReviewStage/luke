import assert from "node:assert/strict";
import test from "node:test";
import { CAPSULE_SIDE_WIDTH, PEEK_SIDE_GROWTH, positionNotchWindow, SURFACE_MARGIN } from "../src";

const notchedDisplay = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 38, width: 1512, height: 944 },
};

/** The widest shape a compact window ever draws, before spring overshoot. */
const peekWidth = (housingWidth: number) =>
  housingWidth + (CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH) * 2;

test("anchors the compact window to the physical top edge", () => {
  const result = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 38,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.deepEqual(result, {
    x: 497,
    y: 0,
    width: 518,
    height: 68,
    notch: {
      topInset: 38,
      housingWidth: 210,
      hasNotch: true,
      source: "appkit",
    },
  });
});

test("a compact window holds the peek, the overshoot, and the shadow", () => {
  const result = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 38,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.equal(result.width, peekWidth(210) + SURFACE_MARGIN * 2);
  // The capsule at rest stays centred on the housing inside that window.
  assert.equal(
    (peekWidth(210) - result.notch.housingWidth) / 2,
    CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH,
  );
});

test("uses a top-center fallback without inventing a notch", () => {
  const result = positionNotchWindow(
    {
      bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
      workArea: { x: -1920, y: -175, width: 1920, height: 1055 },
    },
    "compact",
  );

  assert.equal(result.x, -1114);
  assert.equal(result.y, -200);
  assert.equal(result.width, peekWidth(0) + SURFACE_MARGIN * 2);
  assert.equal(result.height, 32 + SURFACE_MARGIN);
  assert.equal(result.notch.hasNotch, false);
  assert.equal(result.notch.topInset, 25);
  assert.equal(result.notch.source, "work-area");
});

test("keeps the expanded panel attached to the same display edge", () => {
  const result = positionNotchWindow(notchedDisplay, "expanded");

  assert.equal(result.x, 416);
  assert.equal(result.y, 0);
  assert.equal(result.width, 620 + SURFACE_MARGIN * 2);
  assert.equal(result.height, 520 + SURFACE_MARGIN);
});

test("never grows a window past the display it is on", () => {
  const narrow = {
    bounds: { x: 0, y: 0, width: 240, height: 480 },
    workArea: { x: 0, y: 24, width: 240, height: 456 },
  };

  assert.equal(positionNotchWindow(narrow, "compact").width, 240);
  assert.equal(positionNotchWindow(narrow, "expanded").width, 240);
  assert.equal(positionNotchWindow(narrow, "expanded").height, 480);
});
