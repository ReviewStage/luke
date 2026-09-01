import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import {
  BUBBLE_LIFT,
  PANEL_MAX_HEIGHT,
  PANEL_WIDTH,
  SESSION_NOTICE_HEIGHT,
  SESSION_NOTICE_MAX_ROWS,
  VOICE_BAND_INSET,
  VOICE_CAPTION_MAX_HEIGHT,
} from "./generated/motion-tokens.js";

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayGeometry {
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
export function isPanelFormFactor(value: UnparsedWireValue): value is PanelFormFactor {
  if (!isWireString(value)) return false;
  // SAFETY: value is a string; list membership is the form-factor vocabulary contract check.
  return PANEL_FORM_FACTOR_LIST.includes(value as PanelFormFactor);
}

export const DEFAULT_PANEL_FORM_FACTOR: PanelFormFactor = PANEL_FORM_FACTOR.BUBBLE;

/**
 * The housing a display is given when it has none and the user asks for the
 * notch form: the 14-inch MacBook Pro's, the same housing the capture fixture
 * pins and the one every drawn proportion was measured against.
 */
export const SIMULATED_HOUSING_WIDTH = 210;

export type WindowMode = "compact" | "expanded";

/**
 * The room between a detached panel and the compact strip above it.
 * Detachment exists so two instances can share a screen — a development run
 * standing clear of the released app's surface — and the strip is exactly
 * what the released instance draws while idle, so the drop is that strip's
 * own height plus this gap: snug under the housing rather than adrift
 * mid-screen, but never on top of it.
 */
export const DETACHED_PANEL_GAP = 8;

/**
 * How far a detached window stands below the display's top edge: past the
 * compact strip an attached instance draws there — the same
 * `max(32, topInset)` floor the strip itself is measured with — plus the gap.
 * Only the released instance's idle strip is cleared by construction; its
 * expanded panel is a transient sheet that may cover a detached surface while
 * it stands open, and dropping past that too would strand the detached panel
 * mid-screen for the sake of a moment.
 */
export function detachedPanelDrop(topInset: number): number {
  return Math.ceil(Math.max(32, topInset)) + DETACHED_PANEL_GAP;
}

export interface NotchWindowLayout extends Rectangle {
  notch: ResolvedNotchGeometry;
}

/**
 * The window is a stage for a shape the renderer draws and animates; it is not
 * the shape itself. Every window therefore holds the widest thing any mode can
 * draw — the panel, and the peek where a housing outgrows it — plus a margin
 * for what falls outside the shape: a spring overshooting its target, and the
 * shadow the peek and the panel cast. A clipped shadow is a hard edge, so the
 * margin runs along the bottom too. Everything the shape does not cover is
 * transparent and passes the pointer through.
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
// BUBBLE_LIFT, VOICE_CAPTION_MAX_HEIGHT, VOICE_BAND_INSET,
// SESSION_NOTICE_HEIGHT, SESSION_NOTICE_MAX_ROWS, PANEL_WIDTH, and
// PANEL_MAX_HEIGHT come from the shared surface
// tokens, so the window the main process sizes and the shape the renderer
// draws cannot drift. The bubble's lift is derived: the pill matches the 24pt
// menu bar it floats beside — the 32px compact strip minus the lift on each
// side. The compact window holds the caption block for the same reason it
// holds the peek's width — speech must never cost an IPC resize — and every
// row the notice band can grow to below it, because a reply may name several
// sessions under captioned speech. One inset closes the stack: every band
// carries the gap above itself, so the last one still needs its own gap
// before the shape's bottom edge.
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
export const PEEK_MIN_WIDTH = SIMULATED_HOUSING_WIDTH + peekSideWidth * 2;

/** The peek's width beside this housing, never narrower than the floor. */
export function peekWidth(housingWidth: number): number {
  return Math.max(housingWidth + peekSideWidth * 2, PEEK_MIN_WIDTH);
}

function snapToDevicePixels(value: number, scaleFactor?: number): number {
  if (scaleFactor === undefined) return value;
  return Math.round(value * scaleFactor) / scaleFactor;
}

export function resolveNotchGeometry(
  display: DisplayGeometry,
  native?: NativeNotchGeometry,
  formFactor: PanelFormFactor = DEFAULT_PANEL_FORM_FACTOR,
  detached = false,
): ResolvedNotchGeometry {
  const physical: ResolvedNotchGeometry = native
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
  // A detached surface stands clear of the top edge, so nothing it draws can
  // meet a housing: it takes the bubble whatever the display has and whatever
  // the form factor asks, because a housing shape below the real one would
  // read as the production surface having slipped. The physical depth still
  // travels — the strip's height is measured against it either way.
  if (detached) {
    return {
      topInset: physical.topInset,
      housingWidth: 0,
      hasNotch: false,
      source: physical.source,
    };
  }
  // A real housing is never argued with; only its absence takes the form
  // factor's answer. Its resolved depth is carried through untouched — the
  // window and the stylesheet already hold every housing to the same 32px floor.
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
  detached = false,
): NotchWindowLayout {
  const notch = resolveNotchGeometry(display, native, formFactor, detached);
  const drop = detached ? detachedPanelDrop(notch.topInset) : 0;
  const housingWidth = notch.hasNotch ? notch.housingWidth : 0;
  // One width for both modes, so a mode change is a height-only resize and the
  // window never moves. macOS lands a window's move and its content's relayout
  // on different frames, so a mode change that also recentred a narrower
  // window drew the capsule laid out for the new width against the old origin
  // — flashed toward the panel's corner — before the move caught up. A height
  // change has no such tear: the window stays put, and everything a shorter
  // frame crops is transparent margin below a shape that has already closed.
  const width = Math.min(
    Math.max(PANEL_WIDTH, peekWidth(housingWidth)) + SURFACE_MARGIN * 2,
    display.bounds.width,
  );
  // A bubble panel floats `BUBBLE_LIFT` below the top edge, and the margin was
  // measured from a panel drawn at the edge, so the lift is added back or the
  // last of the shadow's tail meets the window edge as a faint line.
  // A dropped window has that much less display below it, so the clamp that
  // keeps a window on its display shrinks by the same drop.
  const height =
    mode === "expanded"
      ? Math.min(
          PANEL_MAX_HEIGHT + SURFACE_MARGIN + (notch.hasNotch ? 0 : BUBBLE_LIFT),
          display.bounds.height - drop,
        )
      : Math.min(
          Math.ceil(Math.max(32, notch.topInset)) +
            VOICE_CAPTION_MAX_HEIGHT +
            SESSION_NOTICE_HEIGHT * SESSION_NOTICE_MAX_ROWS +
            VOICE_BAND_INSET +
            SURFACE_MARGIN,
          display.bounds.height - drop,
        );
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);

  return {
    x,
    // Electron coordinates start at the display's top edge. Anchoring here
    // makes the black surface meet the camera housing instead of floating below
    // the menu bar or in the middle of the screen; a detached surface stands
    // its drop below, clear of the housing and the released instance's strip.
    y: display.bounds.y + drop,
    width,
    height,
    notch,
  };
}
