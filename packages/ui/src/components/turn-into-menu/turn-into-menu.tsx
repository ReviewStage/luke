import {
  WRITING_BLOCK,
  WRITING_SHORTCUTS,
  type WritingBlock,
  type WritingShortcut,
} from "@luke/settings/shortcuts";
import { type DrawnMenu, Menu, type MenuAction } from "../menu/menu.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { WritingGlyph } from "../writing-glyph/writing-glyph.js";

/**
 * turn-into-menu.tsx -- the menu of blocks a line is turned into, the current one checked: Text, the headings, the lists, Quote, and Code block.
 *
 * Each row is the block's glyph, its name, and its chord, which turns the
 * line from the keyboard without the menu, all the vocabulary's
 * (`WRITING_SHORTCUTS`). It is a menu as every menu is (`Menu`): it opens
 * on the current block, the arrows walk it, and choosing a row or Escape
 * closes it, handing focus back to what opened it before the owner hears
 * the block chosen, so the owner may hand the focus on to its editor.
 */

/** The menu's own name. */
const TURN_INTO_LABEL = "Turn into";

/** The blocks in the menu's groups, a rule between each: text and headings, lists, then the rest. */
const TURN_INTO_GROUPS: readonly (readonly WritingBlock[])[] = [
  [WRITING_BLOCK.TEXT, WRITING_BLOCK.HEADING_1, WRITING_BLOCK.HEADING_2, WRITING_BLOCK.HEADING_3],
  [WRITING_BLOCK.BULLETED_LIST, WRITING_BLOCK.NUMBERED_LIST, WRITING_BLOCK.TODO_LIST],
  [WRITING_BLOCK.QUOTE, WRITING_BLOCK.CODE_BLOCK],
];

/** One block's row: its glyph, its name, its chord, and a check where it is the current one. */
function blockAction(
  block: WritingBlock,
  current: WritingBlock | undefined,
  onTurn: (block: WritingBlock) => void,
): MenuAction {
  const shortcut: WritingShortcut = WRITING_SHORTCUTS[block];
  return {
    label: shortcut.label,
    icon: <WritingGlyph action={block} />,
    hint: shortcut.chord === undefined ? undefined : <Shortcut chord={shortcut.chord} />,
    checked: block === current,
    onSelect: () => onTurn(block),
  };
}

/** The Turn into menu hung where `menu` says (`useMenu`'s `drawn`), `current` checked; none is where the selection spans several kinds. */
export function TurnIntoMenu({
  menu,
  current,
  onTurn,
  onClose,
}: {
  menu: DrawnMenu;
  current: WritingBlock | undefined;
  onTurn: (block: WritingBlock) => void;
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  return (
    <Menu
      label={TURN_INTO_LABEL}
      menu={menu}
      openOnChecked
      groups={TURN_INTO_GROUPS.map((group) =>
        group.map((block) => blockAction(block, current, onTurn)),
      )}
      onClose={onClose}
    />
  );
}
