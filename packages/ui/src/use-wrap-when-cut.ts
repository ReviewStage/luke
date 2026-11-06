import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { onFontsSettled } from "./fonts-settled.js";

export interface TitleSeat {
  readonly room: string;
  readonly words: string;
}

const FLOOR_PROPERTY = "--ui-title-floor";

function shownOf(bar: HTMLElement, seat: TitleSeat): { shown: number; whole: number } | undefined {
  const room = bar.querySelector<HTMLElement>(seat.room);
  const all = room?.querySelectorAll<HTMLElement>(seat.words);
  const words = all?.[all.length - 1];
  if (room === null || room === undefined || words === undefined) return undefined;
  const box = words.getBoundingClientRect();
  const shown = Math.max(0, Math.min(box.right, room.getBoundingClientRect().right) - box.left);
  return { shown, whole: words.scrollWidth };
}

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
    const stopFonts = onFontsSettled(() => (wrapped ? setWrapped(false) : settled()));
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      stopFonts();
    };
  });
  return on && wrapped;
}
