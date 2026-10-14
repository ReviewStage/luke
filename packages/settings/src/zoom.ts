/**
 * zoom.ts -- how large Luke draws his window: the sizes Settings offers, and the step ⌘+ and ⌘− take between them.
 *
 * A size is a whole percentage, the way Chrome and VS Code word their own
 * zoom, and the steps are Chrome's between two thirds and twice: the
 * shortcuts walk this one list, and Settings offers the same list, so a key
 * press and a pick are the same stored value.
 */

import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

/** Every size, smallest first: the pop-up's options and the shortcuts' steps. */
export const ZOOM_PERCENTS = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

export type ZoomPercent = (typeof ZOOM_PERCENTS)[number];

/** The size nothing is scaled at, which ⌘0 returns to. */
export const ZOOM_ACTUAL_SIZE = 100 satisfies ZoomPercent;

/** Which way a shortcut steps the size. */
export const ZOOM_STEP = {
  IN: 1,
  OUT: -1,
} as const;

export type ZoomStep = (typeof ZOOM_STEP)[keyof typeof ZOOM_STEP];

const readsZoomPercent = Schema.is(Schema.Literals(ZOOM_PERCENTS));

/** Guards a size arriving from storage or IPC. */
export function isZoomPercent(value: UnparsedWireValue): value is ZoomPercent {
  return readsZoomPercent(value);
}

/** The size one step from `percent`, held at the smallest and the largest rather than wrapping. */
export function zoomStepped(percent: ZoomPercent, step: ZoomStep): ZoomPercent {
  const index = ZOOM_PERCENTS.indexOf(percent) + step;
  return ZOOM_PERCENTS[Math.min(Math.max(index, 0), ZOOM_PERCENTS.length - 1)] ?? percent;
}

/** The size as Electron's zoom factor, where 1 is actual size. */
export function zoomFactor(percent: ZoomPercent): number {
  return percent / 100;
}
