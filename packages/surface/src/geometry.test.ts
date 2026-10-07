import assert from "node:assert/strict";
import { resolveNotchGeometry } from "@sidecar/surface";
import { test } from "vitest";

const notchedDisplay = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 38, width: 1512, height: 944 },
  scaleFactor: 2,
};

test("reads a real housing from the native helper", () => {
  assert.deepEqual(
    resolveNotchGeometry(notchedDisplay, {
      displayId: 1,
      safeAreaTop: 38,
      menuBarHeight: 38,
      notchWidth: 210,
      hasNotch: true,
    }),
    { topInset: 38, housingWidth: 210, hasNotch: true, source: "appkit" },
  );
});

test("falls back to the work area's inset without inventing a notch", () => {
  const result = resolveNotchGeometry({
    bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
    workArea: { x: -1920, y: -175, width: 1920, height: 1055 },
  });

  assert.deepEqual(result, { topInset: 25, housingWidth: 0, hasNotch: false, source: "work-area" });
});

test("a display the helper says has no housing is given none", () => {
  const result = resolveNotchGeometry(
    {
      bounds: { x: 1512, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1512, y: 24, width: 2560, height: 1416 },
    },
    { displayId: 2, safeAreaTop: 0, menuBarHeight: 0, notchWidth: 0, hasNotch: false },
  );

  assert.deepEqual(result, { topInset: 0, housingWidth: 0, hasNotch: false, source: "appkit" });
});

test("uses the painted menu bar when it is deeper than the safe area", () => {
  const reportingMachine = resolveNotchGeometry(notchedDisplay, {
    displayId: 1,
    safeAreaTop: 33,
    menuBarHeight: 34,
    notchWidth: 185,
    hasNotch: true,
  });
  const macBookPro14 = resolveNotchGeometry(notchedDisplay, {
    displayId: 1,
    safeAreaTop: 34,
    menuBarHeight: 37,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.equal(reportingMachine.topInset, 34);
  assert.equal(macBookPro14.topInset, 37);
});

test("keeps the safe-area depth when the menu bar reading is absent", () => {
  const hiddenMenuBar = resolveNotchGeometry(notchedDisplay, {
    displayId: 1,
    safeAreaTop: 34,
    menuBarHeight: 0,
    notchWidth: 210,
    hasNotch: true,
  });
  const olderHelper = resolveNotchGeometry(notchedDisplay, {
    displayId: 1,
    safeAreaTop: 34,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.equal(hiddenMenuBar.topInset, 34);
  assert.equal(olderHelper.topInset, 34);
});

test("snaps a fractional depth to device pixels", () => {
  const result = resolveNotchGeometry(notchedDisplay, {
    displayId: 1,
    safeAreaTop: 33,
    menuBarHeight: 33.7,
    notchWidth: 185,
    hasNotch: true,
  });

  assert.equal(result.topInset, 33.5);
});
