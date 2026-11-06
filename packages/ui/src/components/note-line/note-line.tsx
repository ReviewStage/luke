import type { HTMLAttributes, ReactNode } from "react";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";

export const NOTE_LINE_LOOK = {
  CENTERED: "centered",
  LIST: "list",
  INSET: "inset",
  ROWS: "rows",
  TRAIL: "trail",
} as const;

export type NoteLineLook = (typeof NOTE_LINE_LOOK)[keyof typeof NOTE_LINE_LOOK];

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

type DataMarks = { [mark: `data-${string}`]: string | undefined };

export function NoteLine({
  look = NOTE_LINE_LOOK.CENTERED,
  status = false,
  fill = false,
  selectable = false,
  glyph,
  children,
  ...props
}: HintProps &
  DataMarks & {
    look?: NoteLineLook;
    status?: boolean;
    fill?: boolean;
    selectable?: boolean;
    glyph?: ReactNode;
    children: ReactNode;
  }): React.JSX.Element {
  return (
    <p
      {...props}
      className="ui-note-line"
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
