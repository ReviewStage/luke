/**
 * shell-room.ts -- whether the panel's stage is wide enough for panes side by side, or so narrow, a phone's, that the panel stands as a single pane.
 *
 * The room is read off the stage's width, and on a finger's device its height
 * too (`stage-room.ts`), measured once at
 * the shell's root and handed down from there, so every layout that answers
 * it answers the same room. A narrow room floats the sidebar as a drawer and
 * holds the side panel only full screen (`desktop-shell.tsx`,
 * `use-side-panel.ts`), and shows a screen's list or the item chosen in it
 * one at a time (`hiddenColumns`); the stylesheet reads it off the shell's
 * `data-room`.
 * The desktop's window is never narrower than its least width, wider than
 * either line here, and is worked by a mouse, so the desktop is always wide.
 */

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

/**
 * The stage's heights, in CSS pixels, below which a stage worked by a finger
 * is narrow however wide it is: a phone turned on its side is as wide as a
 * small laptop's tab but leaves panes side by side a strip too short to read,
 * under the browser's own bars and the keyboard. Only at `LEAVE` or taller is
 * it wide again. A mouse's stage is never short, so a short browser window on
 * a laptop keeps its panes side by side.
 */
const SHELL_ROOM_SHORT = {
  ENTER: 500,
  LEAVE: 532,
} as const;

/** What the room is read off: the stage's box, and whether a finger works it. */
export interface StageBox {
  readonly width: number;
  readonly height: number;
  /** Whether the device's main pointer is coarse (`coarse-pointer.ts`). */
  readonly coarse: boolean;
}

/** Whether a stage this size is narrow, given whether it was, so the line it crosses depends on the way it is crossed. */
export function narrowStage(stage: StageBox, was: boolean): boolean {
  if (stage.width < (was ? SHELL_ROOM_NARROW.LEAVE : SHELL_ROOM_NARROW.ENTER)) return true;
  return stage.coarse && stage.height < (was ? SHELL_ROOM_SHORT.LEAVE : SHELL_ROOM_SHORT.ENTER);
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
