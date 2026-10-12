import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "@sidecar/runtime/testing";
import { test } from "vitest";
import {
  placementOf,
  placeWindow,
  readWindowPlacement,
  type WindowPlacement,
  writeWindowPlacement,
} from "./window-placement";

/** A laptop's work area under the menu bar, and an external display to its right. */
const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 };
const EXTERNAL = { x: 1512, y: 0, width: 2560, height: 1415 };
/** The frame a first launch opens at. */
const FIRST = { x: 116, y: 65, width: 1280, height: 840 };

test("a window closed on a display still connected opens where it stood, zoomed or full screen as it was", async (t) => {
  const file = path.join(await temporaryDirectory(t), "main-window.json");
  const left: WindowPlacement = {
    bounds: { x: 1800, y: 200, width: 1600, height: 1000 },
    zoomed: true,
    fullScreen: false,
  };
  writeWindowPlacement(file, left);

  const opened = placeWindow({
    saved: readWindowPlacement(file),
    workAreas: [LAPTOP, EXTERNAL],
    first: FIRST,
  });
  assert.deepEqual(opened, left);
});

test("a window whose display was unplugged opens at the first frame on the displays still there", () => {
  const opened = placeWindow({
    saved: {
      bounds: { x: 1800, y: 200, width: 1600, height: 1000 },
      zoomed: false,
      fullScreen: true,
    },
    workAreas: [LAPTOP],
    first: FIRST,
  });
  assert.deepEqual(opened, { bounds: FIRST, zoomed: false, fullScreen: false });
});

test("a frame hanging past its display's edge, or larger than it, is brought wholly within the work area", () => {
  const opened = placeWindow({
    saved: {
      bounds: { x: 900, y: -40, width: 1800, height: 700 },
      zoomed: false,
      fullScreen: false,
    },
    workAreas: [LAPTOP, { x: 3000, y: 0, width: 800, height: 600 }],
    first: FIRST,
  });
  // Shrunk to the laptop's width, and moved down under its menu bar.
  assert.deepEqual(opened.bounds, { x: 0, y: 25, width: 1512, height: 700 });
});

test("a first launch, or a placement file that is not one, opens at the first frame", async (t) => {
  const directory = await temporaryDirectory(t);
  const missing = path.join(directory, "missing.json");
  const garbled = path.join(directory, "garbled.json");
  writeFileSync(garbled, '{"bounds":{"x":"left"}}');

  for (const file of [missing, garbled]) {
    const opened = placeWindow({
      saved: readWindowPlacement(file),
      workAreas: [LAPTOP],
      first: FIRST,
    });
    assert.deepEqual(opened, { bounds: FIRST, zoomed: false, fullScreen: false });
  }
});

test("a window moved to another display while full screen reopens full screen on that display, not the one it left", () => {
  const kept = placementOf({
    normal: { x: 100, y: 100, width: 1280, height: 840 },
    shown: EXTERNAL,
    zoomed: false,
    fullScreen: true,
  });
  const opened = placeWindow({ saved: kept, workAreas: [LAPTOP, EXTERNAL], first: FIRST });
  assert.deepEqual(opened, {
    bounds: { x: 2152, y: 288, width: 1280, height: 840 },
    zoomed: false,
    fullScreen: true,
  });
});
