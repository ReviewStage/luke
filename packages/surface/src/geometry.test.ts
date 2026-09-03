import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPSULE_SIDE_WIDTH,
  PANEL_FORM_FACTOR,
  PANEL_MAX_HEIGHT,
  PANEL_WIDTH,
  PEEK_MIN_WIDTH,
  PEEK_SIDE_GROWTH,
  positionNotchWindow,
  VOICE_BAND_INSET,
  VOICE_CAPTION_MAX_HEIGHT,
} from "@sidecar/surface";
import { BUBBLE_LIFT } from "./generated/motion-tokens.js";
import { SIMULATED_HOUSING_WIDTH, SURFACE_MARGIN } from "./geometry.js";

const notchedDisplay = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 38, width: 1512, height: 944 },
  scaleFactor: 2,
};

/** The widest shape a compact window ever draws, before spring overshoot. */
const peekWidth = (housingWidth: number) =>
  Math.max(housingWidth + (CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH) * 2, PEEK_MIN_WIDTH);

test("anchors the compact window to the physical top edge", () => {
  const result = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 38,
    menuBarHeight: 38,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.deepEqual(result, {
    x: 406,
    y: 0,
    width: PANEL_WIDTH + SURFACE_MARGIN * 2,
    // The top inset, the caption block Luke's words wrap into below it, the
    // inset that closes the stack against the shape's bottom edge, and the
    // margin the overshoot and the shadow fall in: 38 + 210 + 6 + 40.
    height: 294,
    notch: {
      topInset: 38,
      housingWidth: 210,
      hasNotch: true,
      source: "appkit",
    },
  });
});

test("both modes share one width and origin, so a mode change only resizes down", () => {
  const native = {
    displayId: 1,
    safeAreaTop: 38,
    menuBarHeight: 38,
    notchWidth: 210,
    hasNotch: true,
  };
  const compact = positionNotchWindow(notchedDisplay, "compact", native);
  const expanded = positionNotchWindow(notchedDisplay, "expanded", native);

  // A mode change that also moved the window flashed the capsule against the
  // old origin, because macOS lands the move and the relayout on different
  // frames. Equal widths keep the origin still in both directions.
  assert.equal(compact.width, expanded.width);
  assert.equal(compact.x, expanded.x);
  assert.equal(compact.y, expanded.y);
  // The stage still holds the peek, the overshoot, and the shadow.
  assert.ok(compact.width >= peekWidth(210) + SURFACE_MARGIN * 2);
  // The capsule at rest stays centred on the housing inside that window.
  assert.equal(
    (peekWidth(210) - compact.notch.housingWidth) / 2,
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

  assert.equal(result.x, -1310);
  assert.equal(result.y, -200);
  assert.equal(result.width, PANEL_WIDTH + SURFACE_MARGIN * 2);
  assert.equal(result.height, 32 + VOICE_CAPTION_MAX_HEIGHT + VOICE_BAND_INSET + SURFACE_MARGIN);
  assert.equal(result.notch.hasNotch, false);
  assert.equal(result.notch.topInset, 25);
  assert.equal(result.notch.source, "work-area");
});

test("the notch form gives a display without a housing the simulated one", () => {
  const plainDisplay = {
    bounds: { x: 1512, y: 0, width: 2560, height: 1440 },
    workArea: { x: 1512, y: 24, width: 2560, height: 1416 },
  };
  const result = positionNotchWindow(
    plainDisplay,
    "compact",
    // The AppKit helper answered for this display: no housing, no inset.
    { displayId: 2, safeAreaTop: 0, menuBarHeight: 0, notchWidth: 0, hasNotch: false },
    PANEL_FORM_FACTOR.NOTCH,
  );

  assert.deepEqual(result.notch, {
    topInset: 0,
    housingWidth: SIMULATED_HOUSING_WIDTH,
    hasNotch: true,
    source: "simulated",
  });
  // The window holds the peek around the simulated housing, exactly as it
  // would around a real one of the same width.
  assert.ok(result.width >= peekWidth(SIMULATED_HOUSING_WIDTH) + SURFACE_MARGIN * 2);
  assert.equal(result.height, 32 + VOICE_CAPTION_MAX_HEIGHT + VOICE_BAND_INSET + SURFACE_MARGIN);
});

test("the notch form never argues with a real housing", () => {
  const result = positionNotchWindow(
    notchedDisplay,
    "compact",
    {
      displayId: 1,
      safeAreaTop: 38,
      menuBarHeight: 38,
      notchWidth: 210,
      hasNotch: true,
    },
    PANEL_FORM_FACTOR.NOTCH,
  );

  assert.deepEqual(result.notch, {
    topInset: 38,
    housingWidth: 210,
    hasNotch: true,
    source: "appkit",
  });
});

test("a display without a housing keeps the peek's width beside the 14-inch one", () => {
  const plainDisplay = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
  };

  // Luke's words wrap at the peek's width, so the bubble's window holds the
  // same floored peek the caption block's reservation was measured against —
  // never the 248px left when no housing grows it.
  assert.equal(PEEK_MIN_WIDTH, 210 + (CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH) * 2);
  assert.ok(
    positionNotchWindow(plainDisplay, "compact").width >= PEEK_MIN_WIDTH + SURFACE_MARGIN * 2,
  );
});

test("the bubble form is the default and invents nothing", () => {
  const plainDisplay = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
  };

  assert.deepEqual(
    positionNotchWindow(plainDisplay, "compact"),
    positionNotchWindow(plainDisplay, "compact", undefined, PANEL_FORM_FACTOR.BUBBLE),
  );
  assert.equal(positionNotchWindow(plainDisplay, "compact").notch.hasNotch, false);
});

test("an expanded bubble window holds the lifted panel's shadow", () => {
  const plainDisplay = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
  };

  // The bubble panel floats off the top edge, so its window is taller by the
  // same lift; a housing — real or simulated — keeps the panel at the edge.
  assert.equal(
    positionNotchWindow(plainDisplay, "expanded").height,
    PANEL_MAX_HEIGHT + SURFACE_MARGIN + BUBBLE_LIFT,
  );
  assert.equal(
    positionNotchWindow(plainDisplay, "expanded", undefined, PANEL_FORM_FACTOR.NOTCH).height,
    PANEL_MAX_HEIGHT + SURFACE_MARGIN,
  );
  assert.equal(
    positionNotchWindow(notchedDisplay, "expanded", {
      displayId: 1,
      safeAreaTop: 38,
      menuBarHeight: 38,
      notchWidth: 210,
      hasNotch: true,
    }).height,
    PANEL_MAX_HEIGHT + SURFACE_MARGIN,
  );
});

test("keeps the expanded panel attached to the same display edge", () => {
  const result = positionNotchWindow(notchedDisplay, "expanded", {
    displayId: 1,
    safeAreaTop: 38,
    menuBarHeight: 38,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.equal(result.x, 406);
  assert.equal(result.y, 0);
  assert.equal(result.width, PANEL_WIDTH + SURFACE_MARGIN * 2);
  assert.equal(result.height, PANEL_MAX_HEIGHT + SURFACE_MARGIN);
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

test("uses the painted menu bar when it is deeper than the safe area", () => {
  const reportingMachine = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 33,
    menuBarHeight: 34,
    notchWidth: 185,
    hasNotch: true,
  });
  const macBookPro14 = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 34,
    menuBarHeight: 37,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.equal(reportingMachine.notch.topInset, 34);
  assert.equal(
    reportingMachine.height,
    34 + VOICE_CAPTION_MAX_HEIGHT + VOICE_BAND_INSET + SURFACE_MARGIN,
  );
  assert.equal(macBookPro14.notch.topInset, 37);
});

test("keeps the safe-area depth when the menu bar reading is absent", () => {
  const hiddenMenuBar = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 34,
    menuBarHeight: 0,
    notchWidth: 210,
    hasNotch: true,
  });
  const olderHelper = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 34,
    notchWidth: 210,
    hasNotch: true,
  });

  assert.equal(hiddenMenuBar.notch.topInset, 34);
  assert.equal(olderHelper.notch.topInset, 34);
});

test("snaps fractional depths to device pixels and ceils the window height", () => {
  const result = positionNotchWindow(notchedDisplay, "compact", {
    displayId: 1,
    safeAreaTop: 33,
    menuBarHeight: 33.7,
    notchWidth: 185,
    hasNotch: true,
  });

  assert.equal(result.notch.topInset, 33.5);
  assert.equal(result.height, 34 + VOICE_CAPTION_MAX_HEIGHT + VOICE_BAND_INSET + SURFACE_MARGIN);
});
