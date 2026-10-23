import {
  type ShortcutChord,
  WRITING_SHORTCUTS,
  type WritingAction,
  type WritingShortcut,
} from "@luke/settings/shortcuts";
import type { ReactNode, Ref } from "react";
import { type ComboboxGroup, ComboboxList } from "../combobox/combobox.js";
import { MENU_SURFACE_INSET, MenuSurface } from "../menu/menu-surface.js";
import { type MenuKey, MenuKeys } from "../menu-keys/menu-keys.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { WritingGlyph } from "../writing-glyph/writing-glyph.js";

/**
 * block-menu.tsx -- the list a `/` typed in a document opens: its blocks in groups, each its glyph, its name, and the Markdown that makes it, over the keys it hears.
 *
 * It is drawn as the `@` list is: the menu's surface, edge to edge, under
 * each group's heading the group's rows, the highlighted one washed, and at
 * its foot the keys it hears (`MenuKeys`). A row says at its end how else
 * the block is made, the Markdown typed for it, or, where none makes it,
 * its chord. The keys stay with the editor the `/` was typed in, which
 * steers the highlight (`active`) and names it to a reader by the row's id
 * (`comboboxOptionId`); the list takes only the pointer, which moves the
 * highlight as it passes and chooses a row it presses, the caret staying in
 * the editor. What is offered, narrowed as the words after the `/` are
 * typed, is its owner's; where nothing matches it says so. It takes no
 * class or style: its owner places it in a box of its own.
 */

/** The menu's own name, which its listbox is read by. */
const BLOCK_MENU_LABEL = "Blocks";

/** What the menu says where nothing matches. */
const BLOCK_MENU_EMPTY = "Nothing matches";

/** The keys the menu hears, said at its foot. */
const BLOCK_MENU_KEYS: readonly MenuKey[] = [
  { keys: "↑↓", does: "Move" },
  { keys: "↵", does: "Insert" },
  { keys: "esc", does: "Close" },
];

/** The menu's groups, by the headings they stand under, in the order they are drawn. */
export const BLOCK_MENU_GROUP = {
  BASIC: "Basic",
  LISTS: "Lists",
  BLOCKS: "Blocks",
  INSERT: "Insert",
} as const;

export type BlockMenuGroupLabel = (typeof BLOCK_MENU_GROUP)[keyof typeof BLOCK_MENU_GROUP];

/** One block the menu offers: the owner's key for it, its words, its glyph, and how else it is made. */
export interface BlockMenuRow {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** The Markdown typed for it, shown at the row's end. */
  readonly markdown?: string | undefined;
  /** Its chord, shown at the row's end where no Markdown makes it. */
  readonly chord?: ShortcutChord | undefined;
}

/** A run of rows under one of the menu's headings. */
export interface BlockMenuGroup {
  readonly label: BlockMenuGroupLabel;
  readonly rows: readonly BlockMenuRow[];
}

/** The row a writing action is offered as, its words, glyph, Markdown, and chord the vocabulary's; keyed by the action. */
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

/** How else a row's block is made, at its end: its Markdown, or else its chord. */
function rowHint(row: BlockMenuRow): ReactNode {
  if (row.markdown !== undefined) {
    return <code className="luke-block-menu-markdown">{row.markdown}</code>;
  }
  return row.chord === undefined ? undefined : <Shortcut chord={row.chord} />;
}

/** The groups as the list draws them. */
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

/** The `/` menu over `groups`, the row at `active` highlighted across them all. */
export function BlockMenu({
  id,
  groups,
  active,
  onActiveChange,
  onChoose,
  ref,
}: {
  /** The list's id, which the editor names in `aria-controls`. */
  id: string;
  groups: readonly BlockMenuGroup[];
  /** The highlighted row, from zero across every group, which the editor's keys move. */
  active: number;
  /** The pointer moved over a row, which is the highlight's to answer. */
  onActiveChange: (active: number) => void;
  /** A row pressed. */
  onChoose: (row: BlockMenuRow) => void;
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  // A group with nothing left in it after the owner's narrowing is not headed.
  const shown = groups.filter((group) => group.rows.length > 0);
  const rows = shown.flatMap((group) => group.rows);
  return (
    <MenuSurface ref={ref} className="luke-block-menu" inset={MENU_SURFACE_INSET.NONE}>
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
