import { BUBBLE_LIFT, PANEL_WIDTH, VOICE_CAPTION_MAX_HEIGHT } from "./motion-tokens";

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
  source: "appkit" | "fixture" | "work-area" | "simulated";
}

/**
 * How the compact shape stands on a display without a camera housing — an
 * external monitor, or a MacBook built before the notch. `NOTCH` draws the
 * housing the display never had, pressed into the top edge; `BUBBLE` is the
 * free-floating pill, which is what every display without a housing gets until
 * the user asks otherwise. A display with a real notch answers to neither.
 */
export const PANEL_FORM_FACTOR = {
  NOTCH: "notch",
  BUBBLE: "bubble",
} as const;

export type PanelFormFactor = (typeof PANEL_FORM_FACTOR)[keyof typeof PANEL_FORM_FACTOR];

export const PANEL_FORM_FACTOR_LIST: readonly PanelFormFactor[] = Object.values(PANEL_FORM_FACTOR);

/** Guards a form factor arriving from persisted or renderer-supplied data. */
export function isPanelFormFactor(value: unknown): value is PanelFormFactor {
  return typeof value === "string" && PANEL_FORM_FACTOR_LIST.includes(value as PanelFormFactor);
}

export const DEFAULT_PANEL_FORM_FACTOR: PanelFormFactor = PANEL_FORM_FACTOR.BUBBLE;

/**
 * The housing a display is given when it has none and the user asks for the
 * notch form: the 14-inch MacBook Pro's, the same housing the capture fixture
 * pins and the one every drawn proportion was measured against.
 */
export const SIMULATED_HOUSING_WIDTH = 210;

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
// BUBBLE_LIFT, VOICE_CAPTION_MAX_HEIGHT, and PANEL_WIDTH come from the shared
// surface tokens, so the window the main process sizes and the shape the
// renderer draws cannot drift. The bubble's lift is derived: the pill matches
// the 24pt menu bar it floats beside — the 32px compact strip minus the lift
// on each side. The compact window holds the caption block for the same reason
// it holds the peek's width: speech must never cost an IPC resize.
const peekSideWidth = CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH;
const panelHeight = 520;

export function resolveNotchGeometry(
  display: DisplayGeometry,
  native?: NativeNotchGeometry,
  formFactor: PanelFormFactor = DEFAULT_PANEL_FORM_FACTOR,
): ResolvedNotchGeometry {
  const physical: ResolvedNotchGeometry = native
    ? {
        topInset: Math.max(0, Math.round(native.safeAreaTop)),
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
  // A real housing is never argued with; only its absence takes the form
  // factor's answer. The top inset is carried through untouched — the window
  // and the stylesheet already hold every housing to the same 32px floor.
  if (physical.hasNotch || formFactor !== PANEL_FORM_FACTOR.NOTCH) return physical;
  return {
    topInset: physical.topInset,
    housingWidth: SIMULATED_HOUSING_WIDTH,
    hasNotch: true,
    source: "simulated",
  };
}

export function positionNotchWindow(
  display: DisplayGeometry,
  mode: WindowMode,
  native?: NativeNotchGeometry,
  formFactor: PanelFormFactor = DEFAULT_PANEL_FORM_FACTOR,
): NotchWindowLayout {
  const notch = resolveNotchGeometry(display, native, formFactor);
  const housingWidth = notch.hasNotch ? notch.housingWidth : 0;
  const width =
    mode === "expanded"
      ? Math.min(PANEL_WIDTH + SURFACE_MARGIN * 2, display.bounds.width)
      : Math.min(housingWidth + peekSideWidth * 2 + SURFACE_MARGIN * 2, display.bounds.width);
  // A bubble panel floats `BUBBLE_LIFT` below the top edge, and the margin was
  // measured from a panel drawn at the edge, so the lift is added back or the
  // last of the shadow's tail meets the window edge as a faint line.
  const height =
    mode === "expanded"
      ? Math.min(
          panelHeight + SURFACE_MARGIN + (notch.hasNotch ? 0 : BUBBLE_LIFT),
          display.bounds.height,
        )
      : Math.min(
          Math.max(32, notch.topInset) + VOICE_CAPTION_MAX_HEIGHT + SURFACE_MARGIN,
          display.bounds.height,
        );
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
