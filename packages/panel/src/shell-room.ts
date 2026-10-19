/**
 * shell-room.ts -- whether the panel's stage is wide enough for panes side by side, or so narrow, a phone's, that the panel stands as a single pane.
 *
 * The room is read off the stage's width (`stage-width.ts`), measured once at
 * the shell's root and handed down from there, so every layout that answers
 * it answers the same room. A narrow room floats the sidebar as a drawer and
 * holds the side panel only full screen (`desktop-shell.tsx`,
 * `use-side-panel.ts`), and shows a screen's list or the item chosen in it
 * one at a time (`hiddenColumns`); the stylesheet reads it off the shell's
 * `data-room`.
 * The desktop's window is never narrower than its least width, wider than
 * either line here, so the desktop is always wide.
 */

import { useState } from "react";

/** How much room the stage gives the panel. */
export const SHELL_ROOM = {
  /** Panes stand side by side: the desktop's window, a laptop's tab. */
  WIDE: "wide",
  /** One pane at a time: a phone's width. */
  NARROW: "narrow",
} as const;

export type ShellRoom = (typeof SHELL_ROOM)[keyof typeof SHELL_ROOM];

/**
 * The stage's widths, in CSS pixels, between which the room is narrow or
 * wide. Narrower than `ENTER`, the room is narrow: a side panel at its least
 * width would leave the document beside it too little to read a line. Only
 * at `LEAVE` or wider is it wide again, so a stage dragged across the line
 * does not flip the room at every pixel.
 */
const SHELL_ROOM_NARROW = {
  ENTER: 640,
  LEAVE: 672,
} as const;

/** Whether a stage this wide is narrow, given whether it was, so the line it crosses depends on the way it is crossed. */
function narrowStage(width: number, was: boolean): boolean {
  return width < (was ? SHELL_ROOM_NARROW.LEAVE : SHELL_ROOM_NARROW.ENTER);
}

/**
 * The room the stage's width gives, from the `stageWidth` `useStageWidth`
 * measures; until it has measured, the room is wide. Note that the room
 * follows the width during the render that measured it, so a narrow stage
 * never paints a wide frame first.
 */
export function useShellRoom(stageWidth: number | undefined): ShellRoom {
  const [narrow, setNarrow] = useState(false);
  const nowNarrow = stageWidth === undefined ? narrow : narrowStage(stageWidth, narrow);
  if (nowNarrow !== narrow) setNarrow(nowNarrow);
  return nowNarrow ? SHELL_ROOM.NARROW : SHELL_ROOM.WIDE;
}

/** Which of a list-and-item screen's two columns are hidden. */
export interface HiddenColumns {
  readonly list: boolean;
  readonly item: boolean;
}

/**
 * Which columns of a screen that lists things beside the one chosen, as
 * Settings, a version history, and Chat do, a room hides: neither where it
 * is wide, and where it is narrow the item while the list stands, or the
 * list while the item does, so the one shown takes the whole width.
 */
export function hiddenColumns(room: ShellRoom, listed: boolean): HiddenColumns {
  const narrow = room === SHELL_ROOM.NARROW;
  return { list: narrow && !listed, item: narrow && listed };
}
