import {
  APP_COMMAND,
  APP_SHORTCUTS,
  WRITING_BLOCK,
  WRITING_INSERT,
  type WritingBlock,
  type WritingInsert,
} from "@luke/settings/shortcuts";
import {
  BLOCK_MENU_GROUP,
  BlockMenu,
  type BlockMenuGroupLabel,
  type BlockMenuRow,
  BoardIcon,
  comboboxOptionId,
  ImageIcon,
  POPOVER_SIDE,
  RectFloat,
  TableIcon,
  UserIcon,
  useComboboxField,
  writingRow,
} from "@luke/ui";
import { type ReactNode, type RefObject, useEffect, useId, useState } from "react";
import {
  type ComposerTrigger,
  type EditorBox,
  SLASH_INSERT,
  type SlashBlock,
  type SlashChoice,
} from "../plan-editor/contract.js";

/**
 * block-picker.tsx -- a Markdown document's `/` menu: which blocks the words after the `/` match, the menu drawn under the `/`, and the keys it takes from the editor.
 *
 * The editor reports the `/` word the caret ends (`onTrigger`,
 * `../plan-editor/plan-slash.ts`), and hands the menu its keys first
 * (`onKey`), as it hands the `@` list its own. The menu offers the
 * vocabulary's blocks, its names and Markdown, and the menu's own inserts
 * beside them, a picture and a mention only where the text takes them,
 * and a document's own blocks under the group each names, less any block
 * the document drops; the words typed after the `/` narrow it to the blocks whose name, or an
 * alias the vocabulary does not hold (`/h2`, `/todo`, `/mermaid`), begins
 * with them, and a run that matches nothing closes it, as a space does.
 * ↑ and ↓ move its highlight, Enter or Tab chooses, the caret staying in
 * the editor, and Escape closes it for that `/` alone, until the caret
 * leaves the word. It stands aside while its owner holds it off, as the
 * `@` list's standing does. It is drawn under the `/` (`RectFloat`), inside
 * the box the editor stands in, and moves with the words as they scroll.
 */

/** One block the menu offers: what choosing it lays in, its row, and the words it answers beside its name. */
interface SlashEntry {
  readonly block: SlashChoice;
  readonly row: BlockMenuRow;
  readonly aliases: readonly string[];
}

/** A heading of the menu and the blocks under it. */
interface SlashGroup {
  readonly label: BlockMenuGroupLabel;
  readonly entries: readonly SlashEntry[];
}

/** What the text takes beside its blocks, which the menu offers only where it does. */
export interface BlockPickerOffers {
  readonly pictures: boolean;
  readonly mentions: boolean;
}

/**
 * A block of a document's own the menu offers beside its own, as a review
 * comment offers a suggestion: its row, the group it stands at the end of,
 * the words it answers beside its name, and the Markdown it lays in.
 */
export interface OwnBlock {
  readonly group: BlockMenuGroupLabel;
  readonly row: BlockMenuRow;
  readonly aliases: readonly string[];
  readonly markdown: string;
}

/** The rows a document changes in its menu: its own blocks added, and the menu's blocks that do not apply to it dropped. */
export interface BlockPickerRows {
  readonly added: readonly OwnBlock[];
  readonly dropped: ReadonlySet<SlashBlock>;
}

/** The menu's rows as a document that changes none of them offers them. */
export const SLASH_ROWS: BlockPickerRows = { added: [], dropped: new Set() };

/** A writing block or the divider, as the vocabulary names it, answering the aliases given. */
function vocabulary(block: WritingBlock | WritingInsert, aliases: readonly string[]): SlashEntry {
  return { block, row: writingRow(block), aliases };
}

const DIAGRAM: SlashEntry = {
  block: SLASH_INSERT.DIAGRAM,
  row: { id: SLASH_INSERT.DIAGRAM, label: "Diagram", icon: <BoardIcon />, markdown: "```mermaid" },
  aliases: ["mermaid", "flowchart", "chart"],
};

const TABLE: SlashEntry = {
  block: SLASH_INSERT.TABLE,
  row: { id: SLASH_INSERT.TABLE, label: "Table", icon: <TableIcon /> },
  aliases: ["grid"],
};

const PICTURE: SlashEntry = {
  block: SLASH_INSERT.PICTURE,
  row: {
    id: SLASH_INSERT.PICTURE,
    label: "Picture",
    icon: <ImageIcon />,
    chord: APP_SHORTCUTS[APP_COMMAND.INSERT_PICTURE].chord,
  },
  aliases: ["image", "img", "photo"],
};

const MENTION: SlashEntry = {
  block: SLASH_INSERT.MENTION,
  row: { id: SLASH_INSERT.MENTION, label: "Mention", icon: <UserIcon />, markdown: "@" },
  aliases: ["at", "person", "page"],
};

/** Every block the menu offers, in its groups. */
const SLASH_GROUPS: readonly SlashGroup[] = [
  {
    label: BLOCK_MENU_GROUP.BASIC,
    entries: [
      vocabulary(WRITING_BLOCK.TEXT, ["paragraph", "plain"]),
      vocabulary(WRITING_BLOCK.HEADING_1, ["h1", "title"]),
      vocabulary(WRITING_BLOCK.HEADING_2, ["h2", "subtitle"]),
      vocabulary(WRITING_BLOCK.HEADING_3, ["h3"]),
    ],
  },
  {
    label: BLOCK_MENU_GROUP.LISTS,
    entries: [
      vocabulary(WRITING_BLOCK.BULLETED_LIST, ["ul", "bullet", "unordered"]),
      vocabulary(WRITING_BLOCK.NUMBERED_LIST, ["ol", "ordered"]),
      vocabulary(WRITING_BLOCK.TODO_LIST, ["todo", "task", "checkbox", "checklist"]),
    ],
  },
  {
    label: BLOCK_MENU_GROUP.BLOCKS,
    entries: [
      vocabulary(WRITING_BLOCK.QUOTE, ["blockquote"]),
      vocabulary(WRITING_BLOCK.CODE_BLOCK, ["pre", "snippet"]),
    ],
  },
  {
    label: BLOCK_MENU_GROUP.INSERT,
    entries: [
      DIAGRAM,
      TABLE,
      vocabulary(WRITING_INSERT.DIVIDER, ["hr", "rule", "separator"]),
      PICTURE,
      MENTION,
    ],
  },
];

/** Words as they are matched: lower case, with nothing but letters and digits. */
function folded(words: string): string {
  return words.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Whether a block answers `query`: its name, one of its name's words, or an alias begins with it. */
function answers(entry: SlashEntry, query: string): boolean {
  const asked = folded(query);
  const terms = [entry.row.label, ...entry.row.label.split(/\s+/u), ...entry.aliases].map(folded);
  return terms.some((term) => term.startsWith(asked));
}

/** Whether the text takes what a block lays in, and the document keeps its row. */
function offered(entry: SlashEntry, offers: BlockPickerOffers, rows: BlockPickerRows): boolean {
  if (typeof entry.block !== "string") return true;
  if (rows.dropped.has(entry.block)) return false;
  if (entry.block === SLASH_INSERT.PICTURE) return offers.pictures;
  if (entry.block === SLASH_INSERT.MENTION) return offers.mentions;
  return true;
}

/** A document's own block as the menu offers it. */
function documentEntry(block: OwnBlock): SlashEntry {
  return { block: { markdown: block.markdown }, row: block.row, aliases: block.aliases };
}

/** The groups that answer `query`, each with only its blocks that do, a document's own at the end of theirs, and none left empty. */
function slashGroups(
  query: string,
  offers: BlockPickerOffers,
  rows: BlockPickerRows,
): readonly SlashGroup[] {
  return SLASH_GROUPS.map((group) => ({
    label: group.label,
    entries: [
      ...group.entries,
      ...rows.added.filter((added) => added.group === group.label).map(documentEntry),
    ].filter((entry) => offered(entry, offers, rows) && answers(entry, query)),
  })).filter((group) => group.entries.length > 0);
}

/** The `/` word as reported, and where the box the editor stands in stood then, which the menu is carried with as it scrolls. */
interface Said {
  readonly trigger: ComposerTrigger;
  readonly room: EditorBox | undefined;
}

/** The highlight, kept for the word and the words after it it was moved on. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

/** What an editor drawing a `/` menu wires: the menu while it stands, whether it stands, and the report and the keys the editor hands it. */
export interface BlockPicker {
  readonly menu: ReactNode;
  readonly open: boolean;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
}

/** The `/` menu over the editor standing in `room`, offering what `offers` says the text takes, with the document's `rows` changed, held off while `held`; `onChoose` lays the block in. */
export function useBlockPicker({
  room,
  offers,
  rows = SLASH_ROWS,
  held,
  onChoose,
}: {
  room: RefObject<HTMLElement | null>;
  offers: BlockPickerOffers;
  rows?: BlockPickerRows | undefined;
  held: boolean;
  onChoose: (block: SlashChoice) => void;
}): BlockPicker {
  const listId = useId();
  const [said, setSaid] = useState<Said | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  // The `/` closed with Escape, by where it stands, which stays closed only while the caret is in its word.
  const [closed, setClosed] = useState<number | undefined>(undefined);
  const trigger = said?.trigger;
  const inWord = trigger !== undefined;
  useEffect(() => {
    if (!inWord) setClosed(undefined);
  }, [inWord]);

  const groups = trigger === undefined ? [] : slashGroups(trigger.query, offers, rows);
  const entries = groups.flatMap((group) => group.entries);
  const open = trigger !== undefined && closed !== trigger.start && entries.length > 0 && !held;
  const kept =
    highlight !== undefined &&
    trigger !== undefined &&
    highlight.start === trigger.start &&
    highlight.query === trigger.query;
  const at = kept ? Math.min(highlight.at, entries.length - 1) : 0;
  const moveTo = (index: number) => {
    if (trigger !== undefined)
      setHighlight({ start: trigger.start, query: trigger.query, at: index });
  };
  const choose = (index: number) => {
    const entry = entries[index];
    if (entry !== undefined) onChoose(entry.block);
  };

  // ↑, ↓, Home, End, Enter and Escape steer the menu as any combobox's do; ⌘Enter chooses as a bare Enter does.
  const field = useComboboxField({
    open,
    active: at,
    count: entries.length,
    controls: listId,
    activeId: open ? comboboxOptionId(listId, at) : undefined,
    onActiveChange: moveTo,
    onChoose: choose,
    onEnter: () => choose(at),
    onEscape: () => {
      if (trigger !== undefined) setClosed(trigger.start);
    },
  });

  // The menu's own keys come first: Tab chooses, and a Shift+Enter is the editor's line break, as a modified Home or End is its own.
  const onKey = (event: KeyboardEvent): boolean => {
    if (!open) return false;
    const bare = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (event.key === "Tab" && bare) {
      choose(at);
      return true;
    }
    if (event.key === "Enter" && event.shiftKey) return false;
    if ((event.key === "Home" || event.key === "End") && !bare) return false;
    return field.onKeyDown(event);
  };

  // The `/` where it stands now: where it was reported, carried as far as the room has moved since.
  const slash = (): EditorBox | undefined => {
    const now = room.current?.getBoundingClientRect();
    if (said === undefined || now === undefined || said.room === undefined) return undefined;
    const left = said.trigger.rect.left + now.left - said.room.left;
    const shift = now.top - said.room.top;
    return {
      left,
      right: left,
      top: said.trigger.rect.top + shift,
      bottom: said.trigger.rect.bottom + shift,
    };
  };
  const menu = !open ? null : (
    <RectFloat anchor={slash} side={POPOVER_SIDE.BELOW}>
      <BlockMenu
        id={listId}
        groups={groups.map((group) => ({
          label: group.label,
          rows: group.entries.map((entry) => entry.row),
        }))}
        active={at}
        onActiveChange={moveTo}
        onChoose={(row) => choose(entries.findIndex((entry) => entry.row === row))}
      />
    </RectFloat>
  );

  return {
    menu,
    open,
    // Note that the room is measured as the word is reported, a callback's moment, never in a draw.
    onTrigger: (next) =>
      setSaid(
        next === undefined
          ? undefined
          : { trigger: next, room: room.current?.getBoundingClientRect() },
      ),
    onKey,
  };
}
