/**
 * column-split.ts -- whether a screen that lists things beside the one chosen, the Inbox or Chat, shows the two side by side or one at a time, by the room the screen itself has.
 *
 * The line is drawn by the screen's own width rather than the window's,
 * because the window's Inbox and Chat and a task's own Inbox tab stand in
 * columns of their own, beside a sidebar, a side panel, or neither. A screen
 * that measures nothing is not laid out, and keeps the two columns it starts
 * with.
 */

import { useCallback, useState } from "react";

/**
 * The widths, in CSS pixels, between which a screen shows one column or
 * two. Narrower than `ENTER`, its list at its least width (300) would leave
 * the item beside it less than the 560 a question, a code card, and its
 * options read in (`inbox-list.tsx`), as Chat's place keeps beside its rail
 * (`desktop-chat.tsx`); only wider than `LEAVE` does it split again, so a
 * screen dragged across the line does not split and join at every pixel.
 */
const COLUMN_SPLIT = {
  ENTER: 860,
  LEAVE: 892,
} as const;

/** Whether a screen this wide shows one column, given whether it did, so the line it crosses depends on the way it is crossed. */
function oneColumn(width: number, was: boolean): boolean {
  return width < (was ? COLUMN_SPLIT.LEAVE : COLUMN_SPLIT.ENTER);
}

/** A screen's split as measured: the ref of the element whose width draws the line, and whether it shows one column; neither until measured. */
interface ColumnSplit {
  readonly ref: (element: HTMLElement | null) => (() => void) | undefined;
  readonly single: boolean | undefined;
}

/** Measures the element the ref is given as it resizes, answering whether it shows one column. */
export function useColumnSplit(): ColumnSplit {
  const [single, setSingle] = useState<boolean | undefined>(undefined);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setSingle((was) => oneColumn(width, was === true));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, single };
}
