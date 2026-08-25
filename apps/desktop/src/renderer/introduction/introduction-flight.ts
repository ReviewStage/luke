import { CAPSULE_SIDE_WIDTH } from "@sidecar/surface";

/**
 * Where the flight lands, in the takeover window's own coordinates. The
 * takeover covers the whole display, so the capsule and the panel it aims at
 * are the ones the panel window will draw at the same screen positions the
 * moment the introduction ends — computed from the same generated geometry
 * the real surfaces are cut from, so the landing and the handoff line up.
 */

/** Mirrors `--wing-inset` in base.css: the face's inset from the capsule's edge. */
const WING_INSET = 9;
/** Mirrors `.luke-face` in base.css: the face's drawn size in the wing. */
const WING_FACE_SIZE = 18;
/** Mirrors `--capsule-height`'s floor in base.css. */
const CAPSULE_MIN_HEIGHT = 32;

export interface IntroductionStageGeometry {
  /** The takeover window's width — the whole display's. */
  viewportWidth: number;
  /** The resolved housing width, 0 where the display has none. */
  housingWidth: number;
  /** The menu bar's painted depth, which is the capsule's height. */
  topInset: number;
}

export interface FlightTarget {
  x: number;
  y: number;
}

/** The capsule's height, `--capsule-height`'s own formula. */
export function capsuleHeight(geometry: IntroductionStageGeometry): number {
  return Math.max(geometry.topInset, CAPSULE_MIN_HEIGHT);
}

/**
 * The centre of the wing face's spot in the capsule: one wing-inset in from
 * the capsule's left edge, vertically centred in the strip. This is where
 * Luke lands — he becomes the capsule's own face.
 */
export function capsuleFaceCenter(geometry: IntroductionStageGeometry): FlightTarget {
  const capsuleLeft = geometry.viewportWidth / 2 - geometry.housingWidth / 2 - CAPSULE_SIDE_WIDTH;
  return {
    x: capsuleLeft + WING_INSET + WING_FACE_SIZE / 2,
    y: capsuleHeight(geometry) / 2,
  };
}

/** The size Luke lands at: the wing face's own drawn size. */
export const FLIGHT_LANDING_SIZE = WING_FACE_SIZE;
