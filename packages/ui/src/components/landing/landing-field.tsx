import { useEffect, useRef } from "react";
import { bayerAt, fitCanvas, paintLoop } from "./landing-paint.js";

/**
 * landing-field.tsx -- the landing's quiet grounds: a field of copper dots that drifts behind a stage.
 *
 * It is Canvas 2D, a grid of small square dots in the accent, each cell
 * lit or not by an ordered dither over a slowly moving value, so the field
 * reads as one flat color on the ground and never as a gradient. The
 * pattern is the stage's: a flow of soft bands, rings going out from below,
 * or waves across. Under reduced motion it is drawn once and stands still.
 * Decorative: a canvas with no words of its own, which a reader passes over.
 */

/** What moves through a stage's field. */
export const LANDING_FIELD = {
  FLOW: "flow",
  RINGS: "rings",
  WAVES: "waves",
} as const;

export type LandingFieldPattern = (typeof LANDING_FIELD)[keyof typeof LANDING_FIELD];

/** A cell's lit share, from 0 to 1, at a point of the box at a time. */
type Shade = (x: number, y: number, t: number, width: number, height: number) => number;

/** The cell of each field, in CSS pixels, and how much of it a dot fills. */
const CELL = { FIELD: 7, DOT: 0.42 } as const;

const PATTERNS: Readonly<Record<LandingFieldPattern, Shade>> = {
  [LANDING_FIELD.FLOW]: (x, y, t) =>
    0.17 +
    0.16 *
      Math.sin(x * 0.011 + t * 0.3 + Math.sin(y * 0.012 - t * 0.2) * 2.2) *
      Math.cos(y * 0.008 + t * 0.22),
  [LANDING_FIELD.RINGS]: (x, y, t, width, height) => {
    const reach = Math.hypot(x - width / 2, y - height * 1.05);
    const fade = Math.max(0, 1 - reach / (height * 1.4));
    return 0.22 * (0.5 + 0.5 * Math.sin(reach * 0.04 - t * 0.7)) * fade + 0.06;
  },
  [LANDING_FIELD.WAVES]: (x, y, t) =>
    0.16 + 0.14 * Math.sin(y * 0.03 + Math.sin(x * 0.006 + t * 0.35) * 3),
};

/** The accent the dots are drawn in, read off the canvas's own place in the page. */
function accentOf(canvas: HTMLCanvasElement): string {
  return getComputedStyle(canvas).color;
}

/** Draws one frame of dots over `canvas`, each cell lit where `shade` passes its dither threshold. */
function drawDots(
  canvas: HTMLCanvasElement,
  shade: Shade,
  t: number,
  cell: number,
  ink: string,
): void {
  const ratio = fitCanvas(canvas);
  const context = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!context || width === 0 || height === 0) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = ink;
  const dot = Math.max(1, cell * CELL.DOT);
  for (let j = 0, y = cell / 2; y < height; y += cell, j++) {
    for (let i = 0, x = cell / 2; x < width; x += cell, i++) {
      if (shade(x, y, t, width, height) > bayerAt(i, j))
        context.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
  }
}

/** A canvas that paints `shade` in dots of `cell` while it is on screen. */
function useDots(cell: number, shadeFor: (canvas: HTMLCanvasElement) => Shade) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shadeRef = useRef(shadeFor);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ink = accentOf(canvas);
    const shade = shadeRef.current(canvas);
    return paintLoop(canvas, (t) => drawDots(canvas, shade, t, cell, ink));
  }, [cell]);
  return ref;
}

/** A stage's field of drifting dots, filling the stage behind what it holds. */
export function LandingField({ pattern }: { pattern: LandingFieldPattern }): React.JSX.Element {
  const ref = useDots(CELL.FIELD, () => PATTERNS[pattern]);
  return <canvas ref={ref} className="ui-landing-field" />;
}
