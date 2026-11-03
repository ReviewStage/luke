import { WORDMARK_ART } from "@repo/brand";
import { useEffect, useRef } from "react";
import { bayerAt, fitCanvas, paintLoop, heldStill, roleChannels } from "./landing-paint.js";

/**
 * landing-wordmark.tsx -- the product's wordmark set in copper dots across the foot of the page, a band of light passing through it, and a pointer's trail that turns the dots it crosses to chrome for a moment.
 *
 * `WORDMARK_ART` is drawn into a mask the dots fill, each lit or not by an
 * ordered dither, as the landing's fields are. The grid is a share of the
 * foot's width rather than a size in pixels, and the foot keeps one aspect
 * ratio, so a phone draws the same word in the same number of dots as a
 * desktop, only smaller. Where a pointer passes, the dots it crosses, and a
 * few around them that were dark, take the theme's greys up to its ink, a
 * chrome dithered as flatly as the copper, and fade back to copper as the
 * trail ages. Under reduced motion it is drawn once and the trail is off.
 * Decorative: a canvas with no words of its own, which a reader passes over.
 */

/** Cells across the foot, which a desktop's 1440px draws 6px apart; and how much of its cell a dot fills. */
const GRID = { ACROSS: 240, DOT: 0.42, LEAST: 1.5 } as const;

/** How wide the wordmark runs across the foot, and how far down its top stands. */
const FIT = { WIDTH: 0.94, TOP: 0.08 } as const;

/** The pointer's trail: how long a point of it lasts, its reach as a share of the foot's width, and how many points it keeps. */
const TRAIL = { LIFE: 0.9, REACH: 0.035, POINTS: 32 } as const;

/** The chrome's greys, darkest first: the theme's muted words, its body words, and its ink. */
const CHROME_ROLES = ["--ui-color-text-muted", "--ui-color-text-body", "--ui-color-ink"] as const;

/** A point the pointer passed, in CSS pixels of the foot, and when, in seconds. */
type TrailPoint = { readonly x: number; readonly y: number; readonly at: number };

/** The wordmark's coverage at each CSS pixel of a box `width` by `height`, wide across it and near its top. */
function wordmarkMask(width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return new Uint8ClampedArray(width * height * 4);
  const [left = 0, top = 0, span = 1] = WORDMARK_ART.VIEW_BOX.split(" ").map(Number);
  const scale = (width * FIT.WIDTH) / span;
  context.translate(width * ((1 - FIT.WIDTH) / 2) - left * scale, height * FIT.TOP - top * scale);
  context.scale(scale, scale);
  context.fill(new Path2D(WORDMARK_ART.PATH));
  return context.getImageData(0, 0, width, height).data;
}

/** A colour as CSS from channels between 0 and 1. */
function css([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** How strongly the trail touches the point (x, y) at `t`: 1 under a fresh point, 0 out of reach of every point. */
function trailAt(
  trail: readonly TrailPoint[],
  x: number,
  y: number,
  t: number,
  reach: number,
): number {
  let touch = 0;
  for (const point of trail) {
    const age = (t - point.at) / TRAIL.LIFE;
    if (age >= 1) continue;
    const near = 1 - Math.hypot(x - point.x, y - point.y) / reach;
    if (near > 0) touch = Math.max(touch, near * (1 - age));
  }
  return touch;
}

/** The wordmark's painter: its mask, sized to the foot, and the inks it draws in. */
function wordmarkPainter(canvas: HTMLCanvasElement, trail: TrailPoint[]) {
  const copper = getComputedStyle(canvas).color;
  const chrome = CHROME_ROLES.map((role) => css(roleChannels(canvas, role)));
  let mask: Uint8ClampedArray = new Uint8ClampedArray(0);
  let maskWidth = 0;
  let maskHeight = 0;
  return (t: number): void => {
    const ratio = fitCanvas(canvas);
    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!context || width === 0 || height === 0) return;
    // Note that the mask is redrawn when the foot changes size, because the word is laid out across its width.
    if (width !== maskWidth || height !== maskHeight) {
      mask = wordmarkMask(Math.ceil(width), Math.ceil(height));
      maskWidth = width;
      maskHeight = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const cell = Math.max(GRID.LEAST, width / GRID.ACROSS);
    const dot = Math.max(1, cell * GRID.DOT);
    const reach = width * TRAIL.REACH;
    const band = ((t * 0.06) % 1.4) - 0.2;
    const live = trail.filter((point) => t - point.at < TRAIL.LIFE);
    trail.splice(0, trail.length, ...live);
    for (let j = 0, y = cell / 2; y < height; y += cell, j++) {
      for (let i = 0, x = cell / 2; x < width; x += cell, i++) {
        if (!mask[(Math.floor(y) * Math.ceil(width) + Math.floor(x)) * 4 + 3]) continue;
        const light = Math.exp(-(((x / width - band) * 4) ** 2));
        const touch = live.length === 0 ? 0 : trailAt(live, x, y, t, reach);
        const shade = 0.34 + 0.06 * Math.sin(j * 1.08 + i * 0.06) + light * 0.55 + touch * 0.5;
        const threshold = bayerAt(i, j);
        if (shade <= threshold) continue;
        // Note that a touched dot takes a chrome grey picked by the same dither, so the trail stays flat, never a gradient.
        const grey = Math.min(
          chrome.length - 1,
          Math.floor(touch * chrome.length + threshold * 0.999),
        );
        context.fillStyle = touch > 0.08 ? (chrome[grey] ?? copper) : copper;
        context.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
    }
  };
}

/** The product's wordmark in dots across the foot of the page. */
export function LandingWordmark(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const trail: TrailPoint[] = [];
    const paint = wordmarkPainter(canvas, trail);
    if (heldStill()) return paintLoop(canvas, paint);
    const onMove = (event: PointerEvent): void => {
      const box = canvas.getBoundingClientRect();
      trail.push({
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        at: performance.now() / 1000,
      });
      if (trail.length > TRAIL.POINTS) trail.shift();
    };
    canvas.addEventListener("pointermove", onMove, { passive: true });
    const stop = paintLoop(canvas, paint);
    return () => {
      stop();
      canvas.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <canvas ref={ref} className="ui-landing-wordmark" />;
}
