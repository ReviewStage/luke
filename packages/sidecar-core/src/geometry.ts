export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayGeometry {
  bounds: Rectangle;
  workArea: Rectangle;
}

export interface NativeNotchGeometry {
  displayId: number;
  safeAreaTop: number;
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

export type WindowMode = "compact" | "expanded";

export interface NotchWindowLayout extends Rectangle {
  notch: ResolvedNotchGeometry;
}

/**
 * The window is a stage for a shape the renderer draws and animates; it is not
 * the shape itself. A compact window therefore has to hold the widest thing
 * that can be drawn without the window resizing — the peek the capsule grows
 * into under the pointer — plus a margin for what falls outside the shape: a
 * spring overshooting its target, and the shadow the peek and the panel cast.
 * A clipped shadow is a hard edge, so the margin runs along the bottom too.
 * Everything the shape does not cover is transparent and passes the pointer
 * through.
 *
 * The margin is measured against what actually falls outside the shape rather
 * than chosen: `--surface-shadow` still puts ink about 35px below the panel —
 * a blur's tail reaches further than its radius — and the spring overshoots its
 * target by 1.5%. At 30 the last few percent of that tail met the window edge
 * as a faint line instead of fading out.
 */
export const CAPSULE_SIDE_WIDTH = 36;
export const PEEK_SIDE_GROWTH = 88;
export const SURFACE_MARGIN = 40;
const peekSideWidth = CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH;
const panelWidth = 620;
const panelHeight = 520;

export function resolveNotchGeometry(
  display: DisplayGeometry,
  native?: NativeNotchGeometry,
): ResolvedNotchGeometry {
  if (native) {
    return {
      topInset: Math.max(0, Math.round(native.safeAreaTop)),
      housingWidth: native.hasNotch ? Math.max(0, Math.round(native.notchWidth)) : 0,
      hasNotch: native.hasNotch,
      source: native.source ?? "appkit",
    };
  }

  return {
    topInset: Math.max(0, display.workArea.y - display.bounds.y),
    housingWidth: 0,
    hasNotch: false,
    source: "work-area",
  };
}

export function positionNotchWindow(
  display: DisplayGeometry,
  mode: WindowMode,
  native?: NativeNotchGeometry,
): NotchWindowLayout {
  const notch = resolveNotchGeometry(display, native);
  const housingWidth = notch.hasNotch ? notch.housingWidth : 0;
  const width =
    mode === "expanded"
      ? Math.min(panelWidth + SURFACE_MARGIN * 2, display.bounds.width)
      : Math.min(housingWidth + peekSideWidth * 2 + SURFACE_MARGIN * 2, display.bounds.width);
  const height =
    mode === "expanded"
      ? Math.min(panelHeight + SURFACE_MARGIN, display.bounds.height)
      : Math.min(Math.max(32, notch.topInset) + SURFACE_MARGIN, display.bounds.height);
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);

  return {
    x,
    // Electron coordinates start at the display's top edge. Anchoring here
    // makes the black surface meet the camera housing instead of floating below
    // the menu bar or in the middle of the screen.
    y: display.bounds.y,
    width,
    height,
    notch,
  };
}
