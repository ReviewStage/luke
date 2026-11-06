import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

export const ZOOM_PERCENTS = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

export type ZoomPercent = (typeof ZOOM_PERCENTS)[number];

export const ZOOM_ACTUAL_SIZE = 100 satisfies ZoomPercent;

export const ZOOM_STEP = {
  IN: 1,
  OUT: -1,
} as const;

export type ZoomStep = (typeof ZOOM_STEP)[keyof typeof ZOOM_STEP];

const readsZoomPercent = Schema.is(Schema.Literals(ZOOM_PERCENTS));

export function isZoomPercent(value: UnparsedWireValue): value is ZoomPercent {
  return readsZoomPercent(value);
}

export function zoomStepped(percent: ZoomPercent, step: ZoomStep): ZoomPercent {
  const index = ZOOM_PERCENTS.indexOf(percent) + step;
  return ZOOM_PERCENTS[Math.min(Math.max(index, 0), ZOOM_PERCENTS.length - 1)] ?? percent;
}

export function zoomFactor(percent: ZoomPercent): number {
  return percent / 100;
}
