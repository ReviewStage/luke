import { backToWords } from "@luke/features/words";
import { APP_COMMAND, type KeyedCommand } from "@luke/settings/shortcuts";
import { useMemo } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { FoldingButton, type FoldingButtonHint } from "../folding-button/folding-button.js";
import { NavItem } from "../nav-item/nav-item.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * back-button.tsx -- the one way back: a press that leads to the place above the one shown, wearing the back glyph, its hint saying where it leads and the key that goes there too.
 *
 * Every way back in the window is this button, in one of two looks, by
 * where it stands:
 *
 * - `header`, in a bar: a folding button, its glyph then the place's
 *   name, whose words fold away where the bar says so, as every bar's act
 *   does (`FoldingButton`).
 * - `column`, the first row of a column of places: a nav row in the
 *   column's voice (`NavItem`), its glyph then its words.
 *
 * Both wear the one back glyph (`GLYPH.BACK`), which nothing else draws,
 * and raise the one hint, "Back to {place}" (`backToWords`), with the
 * key that goes back, the window's Back from the shortcuts table unless
 * the place names its own, or says it has none (`NO_BACK_KEY`), as a popover
 * whose own keys step back does where the window's Back goes elsewhere. Note that the hint names the place whether or
 * not the words are folded, because the words name the place alone and
 * the hint says that a press leads there. The key is said, not answered:
 * the app that mounts the button keeps the key's handler, as it keeps
 * the press's.
 */

/** Where a way back stands, which says how it is drawn. */
export const BACK_BUTTON_LOOK = {
  /** In a bar: a folding button, its words folding away where the bar says so. */
  HEADER: "header",
  /** At the top of a column of places: a nav row. */
  COLUMN: "column",
} as const;

export type BackButtonLook = (typeof BACK_BUTTON_LOOK)[keyof typeof BACK_BUTTON_LOOK];

/** What a place that no key of the window goes back from says, so its hint names none. */
export const NO_BACK_KEY = null;

/** A way back, drawn as `look` says, to `place`. */
export function BackButton({
  look = BACK_BUTTON_LOOK.HEADER,
  label,
  place,
  command: named = APP_COMMAND.BACK,
  onBack,
}: {
  /** Where it stands: in a bar where none is said. */
  look?: BackButtonLook | undefined;
  /** Its words, and so its name: the place's own name ("Settings"), or a column's ("All versions"). */
  label: string;
  /** The place it leads to as a sentence names it mid-way, which its hint reads ("chat", "MCP servers"). */
  place: string;
  /** The key that goes back here, which its hint says: the window's Back where none is named, and none for `NO_BACK_KEY`. */
  command?: KeyedCommand | typeof NO_BACK_KEY | undefined;
  /** Goes back. */
  onBack: () => void;
}): React.JSX.Element {
  const hint = backToWords(place);
  const command = named ?? undefined;
  // Note that the hint stays one component while its words and key do, because a new one each draw would remount the button and drop its focus.
  const WayBackHint = useMemo<FoldingButtonHint>(
    () =>
      function WayBackHint({ children }) {
        return (
          <Tooltip label={hint} command={command}>
            {children}
          </Tooltip>
        );
      },
    [hint, command],
  );
  if (look === BACK_BUTTON_LOOK.COLUMN) {
    return (
      <Tooltip label={hint} command={command}>
        <NavItem icon={<GLYPH.BACK />} onClick={onBack}>
          {label}
        </NavItem>
      </Tooltip>
    );
  }
  return <FoldingButton label={label} icon={<GLYPH.BACK />} onClick={onBack} hint={WayBackHint} />;
}
