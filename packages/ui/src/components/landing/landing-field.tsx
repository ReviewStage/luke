import { WORDMARK_ART } from "@luke/brand";
import { useEffect, useRef } from "react";
import { bayerAt, fitCanvas, paintLoop } from "./landing-paint.js";

/**
 * landing-field.tsx -- the landing's quiet grounds: a field of copper dots that drifts behind a stage, and the product's wordmark set in the same dots at the foot of the page.
 *
 * Both are Canvas 2D, a grid of small square dots in the accent, each cell
 * lit or not by an ordered dither over a slowly moving value, so the field
 * reads as one flat colour on the ground and never as a gradient. The
 * pattern is the stage's: a flow of soft bands, rings going out from below,
 * or waves across. The wordmark is `WORDMARK_ART` drawn into a mask the dots
 * fill, a band of brighter copper passing through it. Under reduced motion
 * each is drawn once and stands still. Decorative: a canvas with no words
 * of its own, which a reader passes over.
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

/** The cell of each field and of the wordmark, in CSS pixels, and how much of it a dot fills. */
const CELL = { FIELD: 7, WORDMARK: 6, DOT: 0.42 } as const;

/** How wide the wordmark runs across the foot, and how far down its top stands. */
const WORDMARK_FIT = { WIDTH: 0.94, TOP: 0.08 } as const;

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

/** The wordmark's coverage at each CSS pixel of a box `width` by `height`, wide across it and near its top. */
function wordmarkMask(width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return new Uint8ClampedArray(width * height * 4);
  const [left = 0, top = 0, span = 1] = WORDMARK_ART.VIEW_BOX.split(" ").map(Number);
  const scale = (width * WORDMARK_FIT.WIDTH) / span;
  context.translate(
    width * ((1 - WORDMARK_FIT.WIDTH) / 2) - left * scale,
    height * WORDMARK_FIT.TOP - top * scale,
  );
  context.scale(scale, scale);
  context.fill(new Path2D(WORDMARK_ART.PATH));
  return context.getImageData(0, 0, width, height).data;
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

/** The product's wordmark in dots across the foot of the page, a band of light passing through it. */
export function LandingWordmark(): React.JSX.Element {
  const ref = useDots(CELL.WORDMARK, () => {
    let mask: Uint8ClampedArray = new Uint8ClampedArray(0);
    let maskWidth = 0;
    let maskHeight = 0;
    return (x, y, t, width, height) => {
      // Note that the mask is redrawn when the foot changes size, because the word is laid out across its width.
      const w = Math.ceil(width);
      const h = Math.ceil(height);
      if (w !== maskWidth || h !== maskHeight) {
        mask = wordmarkMask(w, h);
        maskWidth = w;
        maskHeight = h;
      }
      if (!mask[(Math.floor(y) * w + Math.floor(x)) * 4 + 3]) return 0;
      const band = Math.exp(-(((x / width - (((t * 0.06) % 1.4) - 0.2)) * 4) ** 2));
      return 0.34 + 0.06 * Math.sin(y * 0.18 + x * 0.01) + band * 0.55;
    };
  });
  return <canvas ref={ref} className="ui-landing-wordmark" />;
}
