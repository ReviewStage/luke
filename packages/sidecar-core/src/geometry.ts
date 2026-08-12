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
 * into under the pointer — plus enough slack for a spring to overshoot its
 * target before settling. Everything the shape does not cover is transparent
 * and passes the pointer through.
 */
export const CAPSULE_SIDE_WIDTH = 36;
export const PEEK_SIDE_GROWTH = 88;
export const SPRING_OVERSHOOT_ALLOWANCE = 14;
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
      ? Math.min(panelWidth + SPRING_OVERSHOOT_ALLOWANCE * 2, display.bounds.width)
      : Math.min(
          housingWidth + peekSideWidth * 2 + SPRING_OVERSHOOT_ALLOWANCE * 2,
          display.bounds.width,
        );
  const height =
    mode === "expanded"
      ? Math.min(panelHeight + SPRING_OVERSHOOT_ALLOWANCE, display.bounds.height)
      : Math.min(Math.max(32, notch.topInset), display.bounds.height);
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
