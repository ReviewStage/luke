import type { HTMLAttributes, ReactNode } from "react";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";

/**
 * note-line.tsx -- one muted line a list, a menu, a section, or a transcript says in the place its rows would stand: "No shells.", "Nothing matches.", "Working…".
 *
 * A whole tab, pane, or page that stands empty is an `EmptyState`; what is
 * said among other things, with no way on of its own, is a note line. It
 * stands centred in the room the rows would have filled at a body's size
 * (`CENTRED`, a combobox's "Nothing matches"), or at the start of that room
 * in a caption's size and the faintest ink (`LIST`, a section's "Drag tasks
 * here"), or the same words unpadded for a container that insets them
 * (`INSET`, a sidebar section's, set at its rows' inset, or a transcript's
 * quiet lines between and after its messages), or the same words standing
 * at the rows' inset by a margin of their own (`ROWS`, a list's "No tasks
 * yet." among a sidebar's rows), and fills the room a column leaves it
 * where `fill` says so. A trail (`TRAIL`) is the one note led by a glyph:
 * what followed from a message, its glyph in a row's 16px seat and the
 * chips it names after its words, wrapping as one row at the caption's
 * size in the leading of the line that holds it (a transcript's "Forked
 * to" and "Continued in"). A line a reader should hear arrive is a
 * `status`; one a reader may select, as a transcript's words are in a
 * window that holds its other words still, is `selectable`.
 *
 * Its outer spacing is its container's; a caller that finds its line by a
 * mark of its own hands it as a `data-` attribute, and an app's hint wraps
 * it as it wraps a Button, handing it the pointer, touch, and focus
 * handlers it shows and goes on.
 */

/** Where a note stands in its room. */
export const NOTE_LINE_LOOK = {
  CENTRED: "centred",
  LIST: "list",
  INSET: "inset",
  ROWS: "rows",
  TRAIL: "trail",
} as const;

export type NoteLineLook = (typeof NOTE_LINE_LOOK)[keyof typeof NOTE_LINE_LOOK];

/** What an app's hint hands the line it wraps: when to show and go, and what it says of the line. */
type HintProps = Pick<
  HTMLAttributes<HTMLElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onTouchEnd"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

/** The marks a caller finds its line by, as `data-` attributes. */
type DataMarks = { [mark: `data-${string}`]: string | undefined };

/** One line of words: `children`, said as `look` asks, led by `glyph` on a trail, announced where `status` is set. */
export function NoteLine({
  look = NOTE_LINE_LOOK.CENTRED,
  status = false,
  fill = false,
  selectable = false,
  glyph,
  children,
  ...props
}: HintProps &
  DataMarks & {
    look?: NoteLineLook;
    /** Whether a reader hears the line land, as a reading line does. */
    status?: boolean;
    /** Whether it takes the room a flex column leaves it. */
    fill?: boolean;
    /** Whether a reader may select its words in a window that holds its other words still. */
    selectable?: boolean;
    /** The glyph that leads a trail's words, seated as a row's glyph is; none for a line of words alone. */
    glyph?: ReactNode;
    children: ReactNode;
  }): React.JSX.Element {
  return (
    <p
      {...props}
      className="luke-note-line"
      data-look={look}
      data-fill={fill ? "" : undefined}
      data-selectable={selectable ? "" : undefined}
      role={status ? "status" : undefined}
    >
      {glyph === undefined ? null : <GlyphSlot size={ICON_SIZE.MEDIUM}>{glyph}</GlyphSlot>}
      {children}
    </p>
  );
}
