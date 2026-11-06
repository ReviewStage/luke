import { bayerAt, WORDMARK_ART } from "@repo/brand";
import { useEffect, useRef } from "react";
import { fitCanvas, heldStill, paintLoop, roleChannels } from "./landing-paint.js";

const GRID = { ACROSS: 240, NUMERAL_ACROSS: 140, DOT: 0.42, LEAST: 1.5 } as const;

const FIT = { WIDTH: 0.94, TOP: 0.08 } as const;

const TRAIL = { LIFE: 0.9, REACH: 0.035, POINTS: 32 } as const;

const CHROME_ROLES = ["--ui-color-text-muted", "--ui-color-text-body", "--ui-color-ink"] as const;

type TrailPoint = { readonly x: number; readonly y: number; readonly at: number };

const NUMERAL = { FILL: 0.96, WEIGHT: 800, PROBE: 100 } as const;

type MaskShape = (context: CanvasRenderingContext2D, width: number, height: number) => boolean;

const wordmarkShape: MaskShape = (context, width, height) => {
  const [left = 0, top = 0, span = 1] = WORDMARK_ART.VIEW_BOX.split(" ").map(Number);
  const scale = (width * FIT.WIDTH) / span;
  context.translate(width * ((1 - FIT.WIDTH) / 2) - left * scale, height * FIT.TOP - top * scale);
  context.scale(scale, scale);
  context.fill(new Path2D(WORDMARK_ART.PATH));
  return true;
};

function wordsShape(words: string, family: string): MaskShape {
  return (context, width, height) => {
    const probe = `${NUMERAL.WEIGHT} ${NUMERAL.PROBE}px ${family}`;
    if ("fonts" in document && !document.fonts.check(probe, words)) return false;
    context.font = probe;
    const ink = context.measureText(words);
    const inkWidth = ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight;
    const inkHeight = ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent;
    const scale = Math.min((width * NUMERAL.FILL) / inkWidth, (height * NUMERAL.FILL) / inkHeight);
    context.translate(width / 2, height / 2);
    context.scale(scale, scale);
    context.translate(
      (ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2,
      (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
    );
    context.fillText(words, 0, 0);
    return true;
  };
}

function maskOf(shape: MaskShape, width: number, height: number): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return new Uint8ClampedArray(width * height * 4);
  if (!shape(context, width, height)) return null;
  return context.getImageData(0, 0, width, height).data;
}

function css([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

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

function dotPainter(
  canvas: HTMLCanvasElement,
  trail: TrailPoint[],
  shape: MaskShape,
  across: number,
) {
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
    if (width !== maskWidth || height !== maskHeight) {
      const drawn = maskOf(shape, Math.ceil(width), Math.ceil(height));
      if (drawn === null) return;
      mask = drawn;
      maskWidth = width;
      maskHeight = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const cell = Math.max(GRID.LEAST, width / across);
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
        const gray = Math.min(
          chrome.length - 1,
          Math.floor(touch * chrome.length + threshold * 0.999),
        );
        context.fillStyle = touch > 0.08 ? (chrome[gray] ?? copper) : copper;
        context.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
    }
  };
}

function useDotArt(shapeFor: (canvas: HTMLCanvasElement) => MaskShape, across: number) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shapeRef = useRef(shapeFor);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const trail: TrailPoint[] = [];
    const paint = dotPainter(canvas, trail, shapeRef.current(canvas), across);
    if (heldStill()) {
      let live = true;
      if ("fonts" in document) void document.fonts.ready.then(() => live && paint(0));
      const stop = paintLoop(canvas, paint);
      return () => {
        live = false;
        stop();
      };
    }
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
  }, [across]);
  return ref;
}

export function LandingWordmark(): React.JSX.Element {
  const ref = useDotArt(() => wordmarkShape, GRID.ACROSS);
  return <canvas ref={ref} className="ui-landing-wordmark" />;
}

export function LandingDotWords({ words }: { readonly words: string }): React.JSX.Element {
  const ref = useDotArt(
    (canvas) => wordsShape(words, getComputedStyle(canvas).fontFamily),
    GRID.NUMERAL_ACROSS,
  );
  return <canvas ref={ref} className="ui-landing-dot-words" />;
}
