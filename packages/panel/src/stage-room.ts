/**
 * stage-room.ts -- the room the panel's stage gives, measured as it resizes: whether it is narrow enough to stand as one pane, and whether it is too narrow to pin the sidebar.
 *
 * The stage is the shell's root element, the one the panel draws everything
 * in. On the desktop it fills the window, so its width is the window's; in a
 * browser tab, or in a test, it is whatever box the page gives the panel. The
 * shell measures it once, at its root, and hands each layout that folds or
 * rearranges by it the line it reads: the room (`shell-room.ts`) and the
 * sidebar's fold (`sidebar-collapse.ts`).
 *
 * The room is written on the document's root too, as `data-luke-room`, for
 * the layers the panel portals out of the stage, a dialog and the toasts,
 * which stand outside the shell's own `data-room` and must answer the same
 * room rather than a breakpoint of their own.
 *
 * Only those lines are state, never the width itself: the root holds the
 * whole shell, so a width in its state would draw the shell again at every
 * pixel of a window being dragged, where only crossing a line changes what
 * is drawn.
 */

import { useCallback, useLayoutEffect, useState } from "react";
import { COARSE_POINTER, coarsePointerNow } from "./coarse-pointer.js";
import { compactStage } from "./desktop/sidebar-collapse.js";
import { narrowStage, SHELL_ROOM, type ShellRoom } from "./shell-room.js";

/** Which of the stage's lines its width stands past. */
interface StageLines {
  /** Whether the stage is narrow enough to stand the panel as one pane (`shell-room.ts`). */
  readonly narrow: boolean;
  /** Whether the stage is too narrow to pin the sidebar (`sidebar-collapse.ts`). */
  readonly compact: boolean;
}

/** The attribute the document's root wears the room in, for what is portalled out of the stage. */
const ROOM_ATTRIBUTE = "data-luke-room";

/** A stage not yet measured: wide, with the sidebar pinned as its choice says. */
const UNMEASURED: StageLines = { narrow: false, compact: false };

/** What the stage is measured by, and the room its width gives. */
export interface StageRoom {
  /** The stage's own element, whose width is measured. */
  readonly ref: React.RefCallback<HTMLElement>;
  /** How much room the stage gives the panel; wide until a stage laid out has measured. */
  readonly room: ShellRoom;
  /** Whether the stage is too narrow to pin the sidebar; false until a stage laid out has measured. */
  readonly compact: boolean;
}

/**
 * The room the stage gives, measured as it resizes: its width, and on a
 * finger's device whether the screen is a phone's (`shell-room.ts`). Each line keeps
 * its own band, so the way it is crossed decides where it flips. A resize
 * that crosses no line hands back the lines it had, so nothing reading them
 * is drawn again, and a stage that measures nothing, as one not yet laid
 * out, keeps the lines it last had. Note that the first measure lands while
 * the stage is committed, before the window paints, so nothing laid out by
 * it is ever drawn in the wrong room first.
 */
export function useStageRoom(): StageRoom {
  const [lines, setLines] = useState<StageLines>(UNMEASURED);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      if (width <= 0) return;
      const screenSide = Math.min(window.screen.width, window.screen.height);
      const coarse = coarsePointerNow();
      setLines((was) => {
        const narrow = narrowStage({ width, screenSide, coarse }, was.narrow);
        const compact = compactStage(width, was.compact);
        return narrow === was.narrow && compact === was.compact ? was : { narrow, compact };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // A tablet's main pointer changes as a keyboard and trackpad come and go,
    // which no resize reports, and a short stage's room turns on it.
    const pointer = window.matchMedia(COARSE_POINTER);
    pointer.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      pointer.removeEventListener("change", measure);
    };
  }, []);
  const room = lines.narrow ? SHELL_ROOM.NARROW : SHELL_ROOM.WIDE;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute(ROOM_ATTRIBUTE, room);
    return () => root.removeAttribute(ROOM_ATTRIBUTE);
  }, [room]);
  return {
    ref,
    room,
    compact: lines.compact,
  };
}
