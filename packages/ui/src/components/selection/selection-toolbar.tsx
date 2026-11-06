import { SELECTION_WORDS, selectedWords } from "@repo/features/words";
import { GLYPH } from "../../icons/icons.js";
import { IconButton } from "../button/button.js";
import { Menu, type MenuAction, useMenu } from "../menu/menu.js";
import { Tooltip } from "../tooltip/hint.js";
import type { SelectionAct } from "./selection-bar.js";
import { useSelectionKeys } from "./selection-keys.js";

/**
 * selection-toolbar.tsx -- the acts on a list's chosen rows as glyphs in the list's head, for a head that says how many are chosen in its own title, as Mail's and Gmail's do.
 *
 * Where a `SelectionBar` stands at a list's foot and names each act in
 * words, this stands in the head's actions, the head's title saying "3
 * selected" in the list's name's place: each act a glyph its hint names,
 * pressed to do it on every chosen row, or dropping its menu of choices
 * under it (a reminder's times); then ×, which chooses none, as Esc does.
 * It draws nothing while no row is chosen. Its keys, focus, and
 * announcement are every selection toolbar's (`selection-keys.ts`), and it
 * is named by the count, which the head draws.
 */

/** An act the toolbar draws, which a glyph alone must say. */
export type SelectionGlyphAct = SelectionAct & { readonly icon: React.JSX.Element };

/** An act that drops its menu of choices under its glyph. */
function MenuGlyph({
  act,
  menu,
}: {
  act: SelectionGlyphAct;
  menu: readonly (readonly MenuAction[])[];
}): React.JSX.Element {
  const drop = useMenu(true);
  return (
    <>
      <Tooltip label={act.label}>
        <IconButton roving icon={act.icon} label={act.label} {...drop.trigger()} />
      </Tooltip>
      {drop.drawn === undefined ? null : (
        <Menu
          label={act.label}
          menu={drop.drawn}
          groups={menu}
          onClose={drop.close}
          replayUnmasked={act.replayUnmasked}
        />
      )}
    </>
  );
}

/** The glyphs acting on `count` chosen rows of the list `controls` names, and ×; nothing while none is chosen. */
export function SelectionToolbar({
  count,
  acts,
  onClear,
  controls,
}: {
  /** How many rows are chosen. */
  count: number;
  /** What may be done to every chosen row at once, in the order drawn. */
  acts: readonly SelectionGlyphAct[];
  /** Chooses none, as × and Esc do. */
  onClear: () => void;
  /** The id of the list whose rows it acts on, which takes the focus once the toolbar goes. */
  controls: string;
}): React.JSX.Element | null {
  const keys = useSelectionKeys({ count, controls, onClear });
  if (count <= 0) return null;
  return (
    <div
      {...keys}
      role="toolbar"
      aria-label={selectedWords(count)}
      className="ui-selection-toolbar flex flex-none items-center gap-tight-gap"
    >
      {acts.map((act) =>
        act.menu === undefined ? (
          <Tooltip key={act.label} label={act.label}>
            <IconButton roving icon={act.icon} label={act.label} onClick={act.onAct} />
          </Tooltip>
        ) : (
          <MenuGlyph key={act.label} act={act} menu={act.menu} />
        ),
      )}
      <Tooltip label={SELECTION_WORDS.CLEAR_SELECTION}>
        <IconButton
          roving
          icon={<GLYPH.CLOSE />}
          label={SELECTION_WORDS.CLEAR_SELECTION}
          onClick={onClear}
        />
      </Tooltip>
    </div>
  );
}
