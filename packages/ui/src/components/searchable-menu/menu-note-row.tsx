import type { ReactNode } from "react";
import {
  COMBOBOX_ITEM_DETAIL,
  COMBOBOX_ITEM_GLYPH,
  COMBOBOX_ITEM_LABEL,
} from "../../shadcn/combobox.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { ONE_LINE_END } from "../one-line/clipped-line.js";
import { OneLine } from "../one-line/one-line.js";

/**
 * menu-note-row.tsx -- the way out of a menu with nothing to pick, drawn in its note's place as one of its rows: a mark, a name, and at its end the press that mends it or the words saying who can.
 *
 * A disconnected server in the Integrations menu is a row ending in a quiet
 * Connect, and a searchable menu whose list is empty for want of a
 * connection says so the same way here: the row stands at a menu row's
 * height and inset across the whole list, its glyph seated and muted as an
 * option's is, so it lines up with the rows pinned under it. It is not an
 * option: the arrows pass over it and a pick never lands on it, and its
 * press is its end's own quiet button, reached as the note's controls are.
 * A reader who cannot mend it is told who can in muted words at the row's
 * end, cut short with an ellipsis where the row runs out of room and said
 * whole on hover.
 */

/** A note row's way out: a quiet press, or words saying who can mend it. */
export type MenuNoteRowEnd =
  | { readonly action: string; readonly onClick: () => void }
  | { readonly words: string };

/** The row: a menu row's height and inset, stretched across the note's inset to the list's own edges. */
const ROW =
  "ui-menu-note-row -mx-list-inset flex h-menu-row min-w-0 items-center gap-icon-gap self-stretch px-row-inset text-start text-body whitespace-nowrap text-foreground";

/** The row's end, which gives way before its name does. */
const END = "ui-menu-note-row-end ml-auto flex min-w-0 flex-[0_1000_auto] items-center";

/** A menu's way out, in its note's place: `glyph` and `label`, then `end`. */
export function MenuNoteRow({
  glyph,
  label,
  end,
}: {
  glyph: ReactNode;
  label: string;
  end: MenuNoteRowEnd;
}): React.JSX.Element {
  return (
    <div className={ROW}>
      <span className={COMBOBOX_ITEM_GLYPH} aria-hidden="true">
        {glyph}
      </span>
      <span className={COMBOBOX_ITEM_LABEL}>{label}</span>
      <span className={END}>
        {"action" in end ? (
          <Button variant={BUTTON_VARIANT.QUIET} onClick={end.onClick}>
            {end.action}
          </Button>
        ) : (
          <OneLine className={COMBOBOX_ITEM_DETAIL} end={ONE_LINE_END.ELLIPSIS}>
            {end.words}
          </OneLine>
        )}
      </span>
    </div>
  );
}
