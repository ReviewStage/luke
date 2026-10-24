/**
 * column-split.ts -- whether a screen that lists things beside the one chosen, the Inbox, Chat, Settings, a version history, Admin, or an automation's setup and its runs, shows the two side by side or one at a time, by the room the screen itself has.
 *
 * The line is drawn by the screen's own width rather than the window's,
 * because the window's Inbox and Chat and a task's own Inbox tab stand in
 * columns of their own, beside a sidebar, a side panel, or neither, and a
 * screen that takes the whole window is only as wide as the window. A screen
 * that measures nothing is not laid out, and keeps the two columns it starts
 * with.
 */

import { RESIZE_EDGE_SIDE, type ResizeEdgeHandle, useResizeEdge } from "@luke/ui";
import { type RefObject, useCallback, useState } from "react";
import { SIDEBAR_WIDTH, type SidebarCollapse } from "./desktop/sidebar-collapse.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";

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

/**
 * The share of a whole-window screen its list takes at most beside the item
 * chosen: what the split's line leaves its least list (300 of 860), at which
 * `desktop.css` draws the list's column too, so a sidebar dragged wide leaves
 * the item its room.
 */
const LIST_SHARE = 0.35;

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

/** A screen's split as its room and its own width draw it: the ref to measure it by, whether it shows one column, and the room its columns stand in. */
interface ScreenSplit {
  readonly ref: (element: HTMLElement | null) => (() => void) | undefined;
  readonly single: boolean;
  /** Narrow where it shows one column, which `hiddenColumns` and `useNarrowFocus` read; the stage's own room still heads it. */
  readonly columns: ShellRoom;
}

/**
 * Whether a screen in a room shows one column: always in a narrow room, and
 * in a wide one where the screen measures under the line, so a screen too
 * narrow for both stands one at a time as a phone's does, though headed as
 * the window heads it.
 */
export function useScreenSplit(room: ShellRoom): ScreenSplit {
  const { ref, single: measured } = useColumnSplit();
  const single = room === SHELL_ROOM.NARROW || measured === true;
  return { ref, single, columns: single ? SHELL_ROOM.NARROW : SHELL_ROOM.WIDE };
}

/** One ref for a screen's root, which both the focus's hold on it (`useNarrowFocus`) and its split's measure take. */
export function useScreenRef<Element extends HTMLElement>(
  held: RefObject<Element | null>,
  measure: ScreenSplit["ref"],
): (element: Element | null) => () => void {
  return useCallback(
    (element: Element | null) => {
      held.current = element;
      const unmeasure = measure(element);
      return () => {
        held.current = null;
        unmeasure?.();
      };
    },
    [held, measure],
  );
}

/**
 * The edge of a whole-window screen's list, Settings', a version history's,
 * or Admin's, which shares the plans' sidebar's width. Note that the list is
 * drawn no wider than its share of the screen, and its edge's room is that
 * share too, so a drag or a key starts from the width drawn rather than a
 * wider one kept.
 */
export function useListEdge(sidebar: SidebarCollapse): ResizeEdgeHandle {
  return useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width: sidebar.width,
    bounds: SIDEBAR_WIDTH,
    reserve: (screen) => screen.getBoundingClientRect().width * (1 - LIST_SHARE),
    label: "Resize sidebar",
    onResize: sidebar.onResize,
  });
}
