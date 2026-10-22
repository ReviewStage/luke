import type { ReactNode } from "react";

/**
 * note-line.tsx -- one muted line a list, a menu, or a section says in the place its rows would stand: "No shells.", "Nothing matches."
 *
 * A whole tab, pane, or page that stands empty is an `EmptyState`; what is
 * said among other things, with no glyph and no way on, is a note line. It
 * stands centred in the room the rows would have filled at a body's size
 * (`CENTRED`, a combobox's "Nothing matches"), or at the start of that room
 * in a caption's size and the faintest ink (`LIST`, a section's "Drag tasks
 * here"), or the same words unpadded for a container that insets them
 * (`INSET`, a sidebar section's, set at its rows' inset), and fills the room a column leaves it where `fill` says so. A
 * line a reader should hear arrive is a `status`.
 */

/** Where a note stands in its room. */
export const NOTE_LINE_LOOK = {
  CENTRED: "centred",
  LIST: "list",
  INSET: "inset",
} as const;

export type NoteLineLook = (typeof NOTE_LINE_LOOK)[keyof typeof NOTE_LINE_LOOK];

/** One line of words: `children`, said as `look` asks, announced where `status` is set. */
export function NoteLine({
  look = NOTE_LINE_LOOK.CENTRED,
  status = false,
  fill = false,
  children,
}: {
  look?: NoteLineLook;
  /** Whether a reader hears the line land, as a reading line does. */
  status?: boolean;
  /** Whether it takes the room a flex column leaves it. */
  fill?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <p
      className="luke-note-line"
      data-look={look}
      data-fill={fill ? "" : undefined}
      role={status ? "status" : undefined}
    >
      {children}
    </p>
  );
}
