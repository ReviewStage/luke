import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ZOOM_PERCENTS, type ZoomPercent } from "@sidecar/settings";
import { Effect, Layer } from "effect";
import type { Point } from "electron";
import { applyZoomPreference, PanelWindows, type ZoomedWindow } from "./zoom";

/** The title bar's middle as desktop.css draws it, in CSS pixels, and a traffic light's height in points. */
const TITLE_BAR_MIDDLE = 25;
const LIGHT_SIZE = 14;

/**
 * A panel window as Electron's zoom meets it: a page drawn at some factor,
 * and traffic lights standing where they were last put, which open at the
 * corner main creates every window with.
 */
function fakeWindow(): ZoomedWindow & { factor: number; lights: Point | null } {
  const window: ZoomedWindow & { factor: number; lights: Point | null } = {
    factor: 1,
    lights: { x: 18, y: 18 },
    webContents: {
      setZoomFactor: (factor: number) => {
        window.factor = factor;
      },
    },
    setWindowButtonPosition: (position: Point | null) => {
      window.lights = position;
    },
  };
  return window;
}

function panels(windows: readonly ZoomedWindow[]) {
  return Layer.succeed(PanelWindows, { standing: () => windows });
}

it.effect("every standing panel draws at the stored size, and an absent one at actual size", () => {
  const windows = [fakeWindow(), fakeWindow()];
  return Effect.gen(function* () {
    yield* applyZoomPreference(150);
    assert.deepEqual(
      windows.map((window) => window.factor),
      [1.5, 1.5],
    );
    yield* applyZoomPreference(undefined);
    assert.deepEqual(
      windows.map((window) => window.factor),
      [1, 1],
    );
    // Actual size puts the lights back where every window was created.
    assert.deepEqual(
      windows.map((window) => window.lights),
      [
        { x: 18, y: 18 },
        { x: 18, y: 18 },
      ],
    );
  }).pipe(Effect.provide(panels(windows)));
});

it.effect(
  "at every size the traffic lights stay on the middle of the title bar the page draws",
  () => {
    const window = fakeWindow();
    return Effect.gen(function* () {
      for (const percent of ZOOM_PERCENTS) {
        yield* applyZoomPreference(percent satisfies ZoomPercent);
        const lights = window.lights;
        assert.ok(lights, `${percent}% left the lights where AppKit puts them`);
        // As far in as ever: desktop.css divides their width by the zoom instead.
        assert.equal(lights.x, 18, `${percent}%`);
        // Their middle, in points, is the title bar's middle at this zoom, to
        // the point they are rounded to.
        const middle = lights.y + LIGHT_SIZE / 2;
        assert.ok(
          Math.abs(middle - TITLE_BAR_MIDDLE * window.factor) <= 0.5,
          `${percent}% puts their middle at ${middle}`,
        );
      }
    }).pipe(Effect.provide(panels([window])));
  },
);
