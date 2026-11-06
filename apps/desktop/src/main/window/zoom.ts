import { APP_SETTING_SCHEMA, type ZoomPercent, zoomFactor } from "@repo/settings";
import { Context, Effect, MutableRef } from "effect";
import type { Point, WebContents } from "electron";

const TRAFFIC_LIGHTS = { X: 18, Y: 18, SIZE: 14 } as const;

export interface ZoomedWindow {
  readonly webContents: Pick<WebContents, "setZoomFactor">;
  setWindowButtonPosition?(position: Point | null): void;
}

export class PanelWindows extends Context.Service<
  PanelWindows,
  { standing(): readonly ZoomedWindow[] }
>()("@repo/desktop/PanelWindows") {}

export function zoomFactorOf(preference: ZoomPercent | undefined): number {
  return zoomFactor(preference ?? APP_SETTING_SCHEMA.zoom.default);
}

export function trafficLightsAt(factor: number): Point {
  const middle = TRAFFIC_LIGHTS.Y + TRAFFIC_LIGHTS.SIZE / 2;
  return { x: TRAFFIC_LIGHTS.X, y: Math.round(middle * factor - TRAFFIC_LIGHTS.SIZE / 2) };
}

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
