/**
 * landing-paint.ts -- what the landing's canvases share: a role's color read off the page and the frame loop that draws only while a canvas is on screen.
 *
 * Every canvas on the landing paints in the theme's own roles, read at mount
 * through a probe so whatever CSS color a role holds resolves, and lands each
 * cell on a flat color through the brand's 8×8 Bayer map (`@repo/brand`'s
 * `bayerAt`) rather than a gradient. The loop draws once and stands still
 * where motion is held (reduced motion, a capture run), and skips its frames
 * while its canvas is scrolled away.
 */

import { motionHeld } from "../../motion-timing.js";

/** A role's color as sRGB channels between 0 and 1, read through a probe laid beside `near`. */
export function roleChannels(near: HTMLElement, role: string): readonly [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${role})`;
  near.parentElement?.appendChild(probe);
  const parts = getComputedStyle(probe).color.match(/[\d.]+/g) ?? [];
  probe.remove();
  return [Number(parts[0] ?? 0) / 255, Number(parts[1] ?? 0) / 255, Number(parts[2] ?? 0) / 255];
}

/** Whether motion is held still, as reduced motion and a capture run hold it (`motionHeld`). */
export function heldStill(): boolean {
  // Note that a document with no media queries, as jsdom's is, is drawn still, because it lays out no frames to play either.
  return typeof window.matchMedia !== "function" || motionHeld();
}

/**
 * Draws `draw` on every frame while `canvas` is on screen, with the seconds
 * since the page opened, or once at zero where motion is held still. Answers
 * the loop's stop.
 */
export function paintLoop(canvas: HTMLCanvasElement, draw: (seconds: number) => void): () => void {
  if (heldStill()) {
    draw(0);
    return () => undefined;
  }
  let shown = true;
  let frame = 0;
  const watch = new IntersectionObserver(([entry]) => {
    shown = entry?.isIntersecting ?? true;
  });
  watch.observe(canvas);
  const tick = (ms: number): void => {
    if (shown) draw(ms / 1000);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    watch.disconnect();
  };
}

/** Sizes `canvas`'s backing store to its box at the screen's density, capped at 2; answers the density. */
export function fitCanvas(canvas: HTMLCanvasElement): number {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return ratio;
}
