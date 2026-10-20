/**
 * zoom.ts -- the panels' zoom: the stored size applied to every panel window's page, with the traffic lights kept level with the title bar it scales.
 *
 * Electron's page zoom draws every CSS pixel larger or smaller, but the
 * traffic lights are AppKit's and never scale. So the lights move with the
 * zoom instead, staying on the middle of the title bar the page now draws, as
 * VS Code keeps them, and desktop.css divides their width by the same zoom
 * (`--zoom`), so the title bar's own buttons clear them at every size.
 *
 * Note that Chromium remembers a zoom per origin, and every window here loads
 * a file of this build's, so one window's zoom reaches every window: the
 * hidden voice window takes it too, and draws nothing it could change. Each
 * panel is set to the same absolute factor, never stepped from its own, so
 * that memory has nothing to add to.
 */

import { APP_SETTING_SCHEMA, type ZoomPercent, zoomFactor } from "@luke/settings";
import { Context, Effect, MutableRef } from "effect";
import type { Point, WebContents } from "electron";

/**
 * Where the close button's corner sits at actual size, and a light's size.
 * desktop.css's `--traffic-lights-*` are measured from it, so the title bar's
 * own buttons clear the lights.
 */
const TRAFFIC_LIGHTS = { X: 18, Y: 18, SIZE: 14 } as const;

/**
 * One panel window as zoom meets it: its page, and its traffic lights where it
 * has them. `BrowserWindow` satisfies it. Electron types the lights' setter on
 * every platform but defines it on macOS alone, so off a Mac, as in a Linux
 * sandbox's fixture run, the window has no lights to move and the setter is
 * absent.
 */
export interface ZoomedWindow {
  readonly webContents: Pick<WebContents, "setZoomFactor">;
  setWindowButtonPosition?(position: Point | null): void;
}

/**
 * The panel windows standing now. A service rather than the panel manager
 * itself because it is this process's door to the windows' zoom, so a test
 * stands a Layer of its own on it; the window service hands in the panels.
 */
export class PanelWindows extends Context.Service<
  PanelWindows,
  { standing(): readonly ZoomedWindow[] }
>()("@luke/desktop/PanelWindows") {}

/** The stored size as a zoom factor, where an absent one is the schema's default. */
export function zoomFactorOf(preference: ZoomPercent | undefined): number {
  return zoomFactor(preference ?? APP_SETTING_SCHEMA.zoom.default);
}

/**
 * Where the traffic lights stand at a zoom: as far in as ever, and as far
 * down as the title bar's middle is drawn, which scales with the page.
 */
export function trafficLightsAt(factor: number): Point {
  const middle = TRAFFIC_LIGHTS.Y + TRAFFIC_LIGHTS.SIZE / 2;
  return { x: TRAFFIC_LIGHTS.X, y: Math.round(middle * factor - TRAFFIC_LIGHTS.SIZE / 2) };
}

/**
 * Zooms every standing panel to a stored size, its traffic lights with it. A
 * window opened afterwards is created at the same size (`panel-manager.ts`),
 * so its first frame is already drawn at it.
 */
export const applyZoomPreference = /* @__PURE__ */ Effect.fn("desktop/applyZoomPreference")(
  function* (preference: ZoomPercent | undefined) {
    const panels = yield* PanelWindows;
    const factor = zoomFactorOf(preference);
    for (const window of panels.standing()) {
      window.webContents.setZoomFactor(factor);
      window.setWindowButtonPosition?.(trafficLightsAt(factor));
    }
  },
);

/**
 * A steer for the stored zoom that zooms the panels only when the size moved
 * from the one it last applied. Note that the window service steers the
 * appearance before every push of the document, and a panel's zoom and its
 * traffic lights are each a round trip through Chromium and AppKit, so a
 * size that has not moved is not applied again; a panel opened since is
 * already created at it (`panel-manager.ts`).
 */
export function zoomSteer(): (
  preference: ZoomPercent | undefined,
) => Effect.Effect<void, never, PanelWindows> {
  const applied = MutableRef.make<number | undefined>(undefined);
  return (preference) =>
    Effect.suspend(() => {
      const factor = zoomFactorOf(preference);
      if (MutableRef.get(applied) === factor) return Effect.void;
      MutableRef.set(applied, factor);
      return applyZoomPreference(preference);
    });
}
