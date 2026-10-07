export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DisplayGeometry {
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor?: number;
}

export interface NativeNotchGeometry {
  displayId: number;
  safeAreaTop: number;
  menuBarHeight?: number;
  notchWidth: number;
  hasNotch: boolean;
  source?: "appkit" | "fixture";
}

export interface ResolvedNotchGeometry {
  topInset: number;
  housingWidth: number;
  hasNotch: boolean;
  source: "appkit" | "fixture" | "work-area";
}

/**
 * The 14-inch MacBook Pro's housing, the one every drawn proportion was
 * measured against and the one the capture fixture pins.
 */
const REFERENCE_HOUSING_WIDTH = 210;

export type WindowMode = "compact" | "expanded";

/** The capsule's side beside the housing, and how far the peek grows it. */
export const CAPSULE_SIDE_WIDTH = 36;
const PEEK_SIDE_GROWTH = 88;
const peekSideWidth = CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH;

/**
 * The narrowest peek any display is given: the peek's width beside the
 * 14-inch MacBook Pro's housing, the same housing every drawn proportion was
 * measured against. Luke's words wrap at the peek's width, and the caption
 * block's reservation was sized against lines this wide — a bubble growing
 * from no housing at all would wrap them at barely half the width and run a
 * reply past the room the window reserved. Mirrored by `--peek-width`'s floor
 * in the desktop stylesheet.
 */
export const PEEK_MIN_WIDTH = REFERENCE_HOUSING_WIDTH + peekSideWidth * 2;

/** The peek's width beside this housing, never narrower than the floor. */
export function peekWidth(housingWidth: number): number {
  return Math.max(housingWidth + peekSideWidth * 2, PEEK_MIN_WIDTH);
}

function snapToDevicePixels(value: number, scaleFactor?: number): number {
  if (scaleFactor === undefined) return value;
  return Math.round(value * scaleFactor) / scaleFactor;
}

/**
 * The housing a display has, read from AppKit where the native helper
 * answered for it and from the work area's inset where it did not; a display
 * without a housing is never given one.
 */
export function resolveNotchGeometry(
  display: DisplayGeometry,
  native?: NativeNotchGeometry,
): ResolvedNotchGeometry {
  return native
    ? {
        topInset: snapToDevicePixels(
          Math.max(0, native.safeAreaTop, native.menuBarHeight ?? 0),
          display.scaleFactor,
        ),
        housingWidth: native.hasNotch ? Math.max(0, Math.round(native.notchWidth)) : 0,
        hasNotch: native.hasNotch,
        source: native.source ?? "appkit",
      }
    : {
        topInset: Math.max(0, display.workArea.y - display.bounds.y),
        housingWidth: 0,
        hasNotch: false,
        source: "work-area",
      };
}
