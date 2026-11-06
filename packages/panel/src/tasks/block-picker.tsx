import {
  APP_COMMAND,
  APP_SHORTCUTS,
  WRITING_BLOCK,
  WRITING_INSERT,
  type WritingBlock,
  type WritingInsert,
} from "@repo/settings/shortcuts";
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
} from "@repo/ui";
import { type ReactNode, type RefObject, useEffect, useId, useState } from "react";
import {
  type ComposerTrigger,
  type EditorAria,
  type EditorBox,
  listAria,
  SLASH_INSERT,
  type SlashBlock,
  type SlashChoice,
} from "../description-editor/contract.js";

interface SlashEntry {
  readonly block: SlashChoice;
  readonly row: BlockMenuRow;
  readonly aliases: readonly string[];
}

interface SlashGroup {
  readonly label: BlockMenuGroupLabel;
  readonly entries: readonly SlashEntry[];
}

export interface BlockPickerOffers {
  readonly pictures: boolean;
  readonly mentions: boolean;
}

export interface OwnBlock {
  readonly group: BlockMenuGroupLabel;
  readonly row: BlockMenuRow;
  readonly aliases: readonly string[];
  readonly markdown: string;
}

export interface BlockPickerRows {
  readonly added: readonly OwnBlock[];
  readonly dropped: ReadonlySet<SlashBlock>;
}

const SLASH_ROWS: BlockPickerRows = { added: [], dropped: new Set() };

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

function folded(words: string): string {
  return words.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function answers(entry: SlashEntry, query: string): boolean {
  const asked = folded(query);
  const terms = [entry.row.label, ...entry.row.label.split(/\s+/u), ...entry.aliases].map(folded);
  return terms.some((term) => term.startsWith(asked));
}

function offered(entry: SlashEntry, offers: BlockPickerOffers, rows: BlockPickerRows): boolean {
  if (typeof entry.block !== "string") return true;
  if (rows.dropped.has(entry.block)) return false;
  if (entry.block === SLASH_INSERT.PICTURE) return offers.pictures;
  if (entry.block === SLASH_INSERT.MENTION) return offers.mentions;
  return true;
}

function documentEntry(block: OwnBlock): SlashEntry {
  return { block: { markdown: block.markdown }, row: block.row, aliases: block.aliases };
}

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

interface Said {
  readonly trigger: ComposerTrigger;
  readonly room: EditorBox | undefined;
}

interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

export interface BlockPicker {
  readonly menu: ReactNode;
  readonly open: boolean;
  readonly aria: EditorAria;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
}

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
  const menu = (
    <RectFloat open={open} anchor={slash} side={POPOVER_SIDE.BELOW}>
      {!open ? null : (
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
      )}
    </RectFloat>
  );

  return {
    menu,
    open,
    aria: listAria(field.field),
    onTrigger: (next) =>
      setSaid(
        next === undefined
          ? undefined
          : { trigger: next, room: room.current?.getBoundingClientRect() },
      ),
    onKey,
  };
}
