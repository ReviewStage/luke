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

const compactSideWidth = 36;
const compactFallbackWidth = compactSideWidth * 2;
const expandedWidth = 620;
const expandedHeight = 520;

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
  const width =
    mode === "expanded"
      ? Math.min(expandedWidth, display.bounds.width)
      : Math.min(
          notch.hasNotch ? notch.housingWidth + compactSideWidth * 2 : compactFallbackWidth,
          display.bounds.width,
        );
  const height =
    mode === "expanded"
      ? Math.min(expandedHeight, display.bounds.height)
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
