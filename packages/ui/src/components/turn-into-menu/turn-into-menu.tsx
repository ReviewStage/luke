import {
  WRITING_BLOCK,
  WRITING_SHORTCUTS,
  type WritingBlock,
  type WritingShortcut,
} from "@repo/settings/shortcuts";
import { type DrawnMenu, Menu, type MenuAction } from "../menu/menu.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { WritingGlyph } from "../writing-glyph/writing-glyph.js";

const TURN_INTO_LABEL = "Turn into";

const TURN_INTO_GROUPS: readonly (readonly WritingBlock[])[] = [
  [WRITING_BLOCK.TEXT, WRITING_BLOCK.HEADING_1, WRITING_BLOCK.HEADING_2, WRITING_BLOCK.HEADING_3],
  [WRITING_BLOCK.BULLETED_LIST, WRITING_BLOCK.NUMBERED_LIST, WRITING_BLOCK.TODO_LIST],
  [WRITING_BLOCK.QUOTE, WRITING_BLOCK.CODE_BLOCK],
];

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

export function TurnIntoMenu({
  menu,
  current,
  onTurn,
  onClose,
}: {
  menu: DrawnMenu;
  current: WritingBlock | undefined;
  onTurn: (block: WritingBlock) => void;
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  return (
    <Menu
      label={TURN_INTO_LABEL}
      menu={menu}
      openOnChecked
      replayUnmasked
      groups={TURN_INTO_GROUPS.map((group) =>
        group.map((block) => blockAction(block, current, onTurn)),
      )}
      onClose={onClose}
    />
  );
}
