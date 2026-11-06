import { motionHeld } from "../../motion-timing.js";

export function roleChannels(near: HTMLElement, role: string): readonly [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${role})`;
  near.parentElement?.appendChild(probe);
  const parts = getComputedStyle(probe).color.match(/[\d.]+/g) ?? [];
  probe.remove();
  return [Number(parts[0] ?? 0) / 255, Number(parts[1] ?? 0) / 255, Number(parts[2] ?? 0) / 255];
}

export function heldStill(): boolean {
  return typeof window.matchMedia !== "function" || motionHeld();
}

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
