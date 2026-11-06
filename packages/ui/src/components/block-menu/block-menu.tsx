import { type Noun, noMatchWords } from "@repo/features/words";
import {
  SHORTCUT_KEY,
  type ShortcutChord,
  WRITING_SHORTCUTS,
  type WritingAction,
  type WritingShortcut,
} from "@repo/settings/shortcuts";
import type { ReactNode, Ref } from "react";
import { type ComboboxGroup, ComboboxList } from "../combobox/combobox.js";
import { MENU_SURFACE_INSET, MenuSurface } from "../menu/menu-surface.js";
import { type MenuKey, MenuKeys, menuKey } from "../menu-keys/menu-keys.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { WritingGlyph } from "../writing-glyph/writing-glyph.js";

const BLOCK_MENU_LABEL = "Blocks";

const BLOCK: Noun = { one: "block", many: "blocks" };

const BLOCK_MENU_EMPTY = noMatchWords(BLOCK);

const BLOCK_MENU_KEYS: readonly MenuKey[] = [
  menuKey("Move", SHORTCUT_KEY.UP, SHORTCUT_KEY.DOWN),
  menuKey("Insert", SHORTCUT_KEY.ENTER, SHORTCUT_KEY.TAB),
  menuKey("Close", SHORTCUT_KEY.ESCAPE),
];

export const BLOCK_MENU_GROUP = {
  BASIC: "Basic",
  LISTS: "Lists",
  BLOCKS: "Blocks",
  INSERT: "Insert",
} as const;

export type BlockMenuGroupLabel = (typeof BLOCK_MENU_GROUP)[keyof typeof BLOCK_MENU_GROUP];

export interface BlockMenuRow {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly markdown?: string | undefined;
  readonly chord?: ShortcutChord | undefined;
}

export interface BlockMenuGroup {
  readonly label: BlockMenuGroupLabel;
  readonly rows: readonly BlockMenuRow[];
}

export function writingRow(action: WritingAction): BlockMenuRow {
  const shortcut: WritingShortcut = WRITING_SHORTCUTS[action];
  return {
    id: action,
    label: shortcut.label,
    icon: <WritingGlyph action={action} />,
    markdown: shortcut.markdown,
    chord: shortcut.chord,
  };
}

function rowHint(row: BlockMenuRow): ReactNode {
  if (row.markdown !== undefined) {
    return <code className="ui-block-menu-markdown">{row.markdown}</code>;
  }
  return row.chord === undefined ? undefined : <Shortcut chord={row.chord} />;
}

function listGroups(groups: readonly BlockMenuGroup[]): ComboboxGroup[] {
  return groups.map((group) => ({
    label: group.label,
    options: group.rows.map((row) => ({
      id: row.id,
      label: row.label,
      icon: row.icon,
      hint: rowHint(row),
    })),
  }));
}

export function BlockMenu({
  id,
  groups,
  active,
  onActiveChange,
  onChoose,
  ref,
}: {
  id: string;
  groups: readonly BlockMenuGroup[];
  active: number;
  onActiveChange: (active: number) => void;
  onChoose: (row: BlockMenuRow) => void;
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  const shown = groups.filter((group) => group.rows.length > 0);
  const rows = shown.flatMap((group) => group.rows);
  return (
    <MenuSurface ref={ref} className="ui-block-menu" inset={MENU_SURFACE_INSET.NONE}>
      <ComboboxList
        id={id}
        label={BLOCK_MENU_LABEL}
        groups={listGroups(shown)}
        active={active}
        onActiveChange={onActiveChange}
        onChoose={(index) => {
          const row = rows[index];
          if (row !== undefined) onChoose(row);
        }}
        empty={BLOCK_MENU_EMPTY}
      />
      <MenuKeys keys={BLOCK_MENU_KEYS} />
    </MenuSurface>
  );
}
