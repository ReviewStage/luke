import type { Box } from "./popover-place.js";

/**
 * clip-room.ts -- the boxes around a layer laid in the page that clip what overflows them, and a room cut to what they show.
 *
 * A layer laid absolutely, a popover hung from its button or a submenu from
 * its row, is cut off by every box on its way up to the window that clips
 * what overflows it: a Settings picker's menu opened inside a popover's card
 * that scrolls is cut at the card's edge. So the room it turns and shrinks
 * inside is cut to each such box, along each axis the box clips. The way up
 * follows the boxes it is laid in, as overflow does: an absolute box is laid
 * in its nearest positioned ancestor (its `offsetParent`), past any box
 * between that does not clip it, and a fixed box in the window, which no box
 * around it clips. The page's own boxes hand their overflow to the window,
 * which its owner's room already keeps to.
 */

/** The overflow that clips nothing; any other value on an axis clips it. */
const UNCLIPPED = "visible";

/** The box `element` is laid in, whose overflow may clip it; none where only the window stands above. */
function containerOf(element: HTMLElement): HTMLElement | null {
  const { position } = getComputedStyle(element);
  if (position === "fixed") return null;
  const next = position === "absolute" ? element.offsetParent : element.parentElement;
  const page = next === document.body || next === document.documentElement;
  return next instanceof HTMLElement && !page ? next : null;
}

/** The boxes that clip `layer`, nearest first; none where only the window does. */
export function clipsAround(layer: HTMLElement): HTMLElement[] {
  const clips: HTMLElement[] = [];
  for (let at = containerOf(layer); at !== null; at = containerOf(at)) {
    const { overflowX, overflowY } = getComputedStyle(at);
    if (overflowX !== UNCLIPPED || overflowY !== UNCLIPPED) clips.push(at);
  }
  return clips;
}

/** `room` cut to what each of `clips` shows, along each axis it clips. */
export function cutTo(room: Box, clips: readonly HTMLElement[]): Box {
  let { left, top, right, bottom } = room;
  for (const clip of clips) {
    const box = clip.getBoundingClientRect();
    const { overflowX, overflowY } = getComputedStyle(clip);
    if (overflowX !== UNCLIPPED) {
      left = Math.max(left, box.left);
      right = Math.min(right, box.right);
    }
    if (overflowY !== UNCLIPPED) {
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
  }
  return { left, top, right, bottom };
}
