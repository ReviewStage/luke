import assert from "node:assert/strict";
import test from "node:test";
import { positionNotchWindow } from "../src";

const notchedDisplay = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 38, width: 1512, height: 944 },
};

test("anchors the compact window to the physical top edge", () => {
  const result = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 38,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.deepEqual(result, {
    x: 615,
    y: 0,
    width: 282,
    height: 38,
    notch: {
      topInset: 38,
      housingWidth: 210,
      hasNotch: true,
      source: "appkit",
    },
  });
  assert.equal((result.width - result.notch.housingWidth) / 2, 36);
});

test("uses a top-center fallback without inventing a notch", () => {
  const result = positionNotchWindow(
    {
      bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
      workArea: { x: -1920, y: -175, width: 1920, height: 1055 },
    },
    "compact",
  );

  assert.equal(result.x, -996);
  assert.equal(result.y, -200);
  assert.equal(result.width, 72);
  assert.equal(result.height, 32);
  assert.equal(result.notch.hasNotch, false);
  assert.equal(result.notch.topInset, 25);
  assert.equal(result.notch.source, "work-area");
});

test("keeps the expanded panel attached to the same display edge", () => {
  const result = positionNotchWindow(notchedDisplay, "expanded");

  assert.equal(result.x, 446);
  assert.equal(result.y, 0);
  assert.equal(result.width, 620);
  assert.equal(result.height, 520);
});
