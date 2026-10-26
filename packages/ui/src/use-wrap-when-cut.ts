/**
 * use-wrap-when-cut.ts -- whether a bar stands its title on a row of its own, because one row would cut it under the readable floor.
 *
 * A bar's title fades where the bar cuts it, as any title does, for as long
 * as what shows of it reads (`--luke-title-floor`); once one row would show
 * less, and less than the whole title, the bar stands the title on a row of
 * its own, and goes back to one row only once it is again as wide as that
 * row then needed. The bar is read two frames after each render, each
 * resize, and each time the page's fonts finish loading, which moves the
 * title's words inside a bar that keeps its width, once anything inside it
 * that answers its width on its own (a path's fold) has settled; a title
 * wrapped in the font before is stood on one row again to be read afresh. A host
 * with no resize observer lays nothing out, so its bar never wraps.
 */

import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { onFontsSettled } from "./fonts-settled.js";

/** Where a bar's title stands on one row: the room it is cut by, and its words, both found inside the bar. */
export interface TitleSeat {
  /** The box whose edge cuts the title. */
  readonly room: string;
  /** The title's words; the last match is the one read, as a path's last crumb is its page. */
  readonly words: string;
}

/** The custom property, registered as a length, that names how much of a title must show before it is moved. */
const FLOOR_PROPERTY = "--luke-title-floor";

/** How much of the title shows on one row: its words up to the room's edge. */
function shownOf(bar: HTMLElement, seat: TitleSeat): { shown: number; whole: number } | undefined {
  const room = bar.querySelector<HTMLElement>(seat.room);
  const all = room?.querySelectorAll<HTMLElement>(seat.words);
  const words = all?.[all.length - 1];
  if (room === null || room === undefined || words === undefined) return undefined;
  // Note that a crumb may hold its floor and be cut by the room rather than shrink, so what shows is the words within the room.
  const box = words.getBoundingClientRect();
  const shown = Math.max(0, Math.min(box.right, room.getBoundingClientRect().right) - box.left);
  return { shown, whole: words.scrollWidth };
}

/** Whether the bar at `frame` stands its title, found at `seat`, on a row of its own; never where `on` is false. */
export function useWrapWhenCut(
  frame: RefObject<HTMLElement | null>,
  seat: TitleSeat,
  on = true,
): boolean {
  const [wrapped, setWrapped] = useState(false);
  const needed = useRef(0);
  useLayoutEffect(() => {
    const bar = frame.current;
    if (!on || bar === null || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const width = bar.clientWidth;
      if (wrapped) {
        if (width >= needed.current) setWrapped(false);
        return;
      }
      const title = shownOf(bar, seat);
      if (title === undefined || title.whole - title.shown <= 1) return;
      const floor = Number.parseFloat(getComputedStyle(bar).getPropertyValue(FLOOR_PROPERTY));
      const short = Math.min(title.whole, Number.isNaN(floor) ? 0 : floor) - title.shown;
      if (short <= 0) return;
      needed.current = width + short;
      setWrapped(true);
    };
    // Note that what answers the bar's width on its own observer settles a frame later, so the bar is read two frames on.
    let frameId = 0;
    const settled = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = requestAnimationFrame(measure);
      });
    };
    settled();
    const observer = new ResizeObserver(settled);
    observer.observe(bar);
    // Note that a wrapped title stands on one row again to be read once the fonts load, because the width it needed was read in the font before.
    const stopFonts = onFontsSettled(() => (wrapped ? setWrapped(false) : settled()));
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      stopFonts();
    };
  });
  return on && wrapped;
}
