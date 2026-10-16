import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { Point } from "electron";
import { describe } from "vitest";
import { applyZoomPreference, PanelWindows, type ZoomedWindow } from "./zoom";

/** What a panel was told: the zoom its page was given, and where its lights were moved if it has any. */
interface Seen {
  zoom?: number;
  lights?: Point | null;
}

/** A panel that keeps what it was told, with traffic lights as on a Mac or none as elsewhere. */
function panel(withLights: boolean) {
  const seen: Seen = {};
  const window: ZoomedWindow = {
    webContents: {
      setZoomFactor: (factor) => {
        seen.zoom = factor;
      },
    },
    ...(withLights && {
      setWindowButtonPosition: (position: Point | null) => {
        seen.lights = position;
      },
    }),
  };
  return { window, seen };
}

describe("applying the stored zoom to the panels", () => {
  it.effect("zooms a panel with no traffic lights, as off a Mac, as well as one with them", () =>
    Effect.gen(function* () {
      const mac = panel(true);
      const linux = panel(false);
      yield* applyZoomPreference(125).pipe(
        Effect.provideService(PanelWindows, { standing: () => [mac.window, linux.window] }),
      );
      assert.equal(mac.seen.zoom, 1.25);
      assert.equal(linux.seen.zoom, 1.25);
      assert.notEqual(mac.seen.lights, undefined);
      assert.equal(linux.seen.lights, undefined);
    }),
  );
});
