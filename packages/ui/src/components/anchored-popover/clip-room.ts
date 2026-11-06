import type { Box } from "./popover-place.js";

const UNCLIPPED = "visible";

function containerOf(element: HTMLElement): HTMLElement | null {
  const { position } = getComputedStyle(element);
  if (position === "fixed") return null;
  const next = position === "absolute" ? element.offsetParent : element.parentElement;
  const page = next === document.body || next === document.documentElement;
  return next instanceof HTMLElement && !page ? next : null;
}

export function clipsAround(layer: HTMLElement): HTMLElement[] {
  const clips: HTMLElement[] = [];
  for (let at = containerOf(layer); at !== null; at = containerOf(at)) {
    const { overflowX, overflowY } = getComputedStyle(at);
    if (overflowX !== UNCLIPPED || overflowY !== UNCLIPPED) clips.push(at);
  }
  return clips;
}

export function cutTo(room: Box, clips: readonly HTMLElement[]): Box {
  let { left, top, right, bottom } = room;
  for (const clip of clips) {
    const box = clip.getBoundingClientRect();
    const { overflowX, overflowY } = getComputedStyle(clip);
    if (overflowX !== UNCLIPPED) {
      left = Math.max(left, box.left + clip.clientLeft);
      right = Math.min(right, box.left + clip.clientLeft + clip.clientWidth);
    }
    if (overflowY !== UNCLIPPED) {
      top = Math.max(top, box.top + clip.clientTop);
      bottom = Math.min(bottom, box.top + clip.clientTop + clip.clientHeight);
    }
  }
  return { left, top, right, bottom };
}
