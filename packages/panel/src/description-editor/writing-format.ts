import {
  SHORTCUT_KEY,
  WRITING_BLOCK,
  WRITING_MARK,
  type WritingBlock,
  type WritingMark,
} from "@repo/settings/shortcuts";
import { clipsAround, cutTo } from "@repo/ui/clip-room";
import { visibleViewport } from "@repo/ui/visible-viewport";
import { type AnyExtension, type ChainedCommands, type Editor, Extension } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorBox, EditorFormat, EditorFormatDoors, EditorFormatting } from "./contract.js";
import { keymapName, selectionTouchesCell } from "./writing-keys.js";

const MARK_NAMES = {
  [WRITING_MARK.BOLD]: "bold",
  [WRITING_MARK.ITALIC]: "italic",
  [WRITING_MARK.STRIKE]: "strike",
  [WRITING_MARK.CODE]: "code",
  [WRITING_MARK.LINK]: "link",
} as const satisfies Record<WritingMark, string>;

const WRITING_MARKS: readonly WritingMark[] = Object.values(WRITING_MARK);

const WRAPPING_BLOCKS: ReadonlyMap<string, WritingBlock> = new Map([
  ["taskList", WRITING_BLOCK.TODO_LIST],
  ["bulletList", WRITING_BLOCK.BULLETED_LIST],
  ["orderedList", WRITING_BLOCK.NUMBERED_LIST],
  ["blockquote", WRITING_BLOCK.QUOTE],
]);

const HEADING_BLOCKS: ReadonlyMap<number, WritingBlock> = new Map([
  [1, WRITING_BLOCK.HEADING_1],
  [2, WRITING_BLOCK.HEADING_2],
  [3, WRITING_BLOCK.HEADING_3],
]);

const LIST_BLOCKS: ReadonlySet<WritingBlock> = new Set([
  WRITING_BLOCK.BULLETED_LIST,
  WRITING_BLOCK.NUMBERED_LIST,
  WRITING_BLOCK.TODO_LIST,
]);

const TURNS = {
  [WRITING_BLOCK.TEXT]: (chain) => chain.setParagraph(),
  [WRITING_BLOCK.HEADING_1]: (chain) => chain.setHeading({ level: 1 }),
  [WRITING_BLOCK.HEADING_2]: (chain) => chain.setHeading({ level: 2 }),
  [WRITING_BLOCK.HEADING_3]: (chain) => chain.setHeading({ level: 3 }),
  [WRITING_BLOCK.BULLETED_LIST]: (chain) => chain.toggleBulletList(),
  [WRITING_BLOCK.NUMBERED_LIST]: (chain) => chain.toggleOrderedList(),
  [WRITING_BLOCK.TODO_LIST]: (chain) => chain.toggleTaskList(),
  [WRITING_BLOCK.QUOTE]: (chain) => chain.setBlockquote(),
  [WRITING_BLOCK.CODE_BLOCK]: (chain) => chain.setCodeBlock(),
} as const satisfies Record<WritingBlock, (chain: ChainedCommands) => ChainedCommands>;

function blockAt($at: ResolvedPos): WritingBlock | undefined {
  const own = $at.parent;
  if (own.type.name === "heading") return HEADING_BLOCKS.get(Number(own.attrs.level));
  if (own.type.name === "codeBlock") return WRITING_BLOCK.CODE_BLOCK;
  for (let depth = $at.depth - 1; depth > 0; depth -= 1) {
    const wrapped = WRAPPING_BLOCKS.get($at.node(depth).type.name);
    if (wrapped !== undefined) return wrapped;
  }
  return own.type.name === "paragraph" ? WRITING_BLOCK.TEXT : undefined;
}

function selectedBlocks(editor: Editor): ReadonlySet<WritingBlock | undefined> {
  const { doc, selection } = editor.state;
  const blocks = new Set<WritingBlock | undefined>();
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isTextblock) return true;
    blocks.add(blockAt(doc.resolve(pos + 1)));
    return false;
  });
  if (blocks.size === 0) blocks.add(blockAt(selection.$from));
  return blocks;
}

function formatOf(editor: Editor): EditorFormat {
  const { from, to, empty } = editor.state.selection;
  const blocks = selectedBlocks(editor);
  const linked = editor.isActive(MARK_NAMES[WRITING_MARK.LINK]);
  const href: unknown = editor.getAttributes(MARK_NAMES[WRITING_MARK.LINK]).href;
  return {
    from,
    to,
    empty,
    code: blocks.has(WRITING_BLOCK.CODE_BLOCK),
    cell: selectionTouchesCell(editor.state),
    marks: WRITING_MARKS.filter((mark) => editor.isActive(MARK_NAMES[mark])),
    block: blocks.size === 1 ? [...blocks][0] : undefined,
    link: linked && typeof href === "string" ? href : undefined,
  };
}

function shows(seen: EditorBox, line: DOMRect): boolean {
  return (
    line.bottom > seen.top &&
    line.top < seen.bottom &&
    line.right > seen.left &&
    line.left < seen.right
  );
}

function shownBox(lines: readonly DOMRect[], seen: EditorBox): EditorBox | undefined {
  const shown = lines.some((line) => shows(seen, line))
    ? lines.filter((line) => shows(seen, line))
    : lines;
  if (shown.length === 0) return undefined;
  const held = (at: number, low: number, high: number) => Math.min(Math.max(at, low), high);
  return {
    left: held(Math.min(...shown.map((line) => line.left)), seen.left, seen.right),
    top: held(Math.min(...shown.map((line) => line.top)), seen.top, seen.bottom),
    right: held(Math.max(...shown.map((line) => line.right)), seen.left, seen.right),
    bottom: held(Math.max(...shown.map((line) => line.bottom)), seen.top, seen.bottom),
  };
}

function selectionBox(editor: Editor): EditorBox | undefined {
  const { view, state } = editor;
  try {
    const start = view.domAtPos(state.selection.from);
    const end = view.domAtPos(state.selection.to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const seen = cutTo(visibleViewport(), [view.dom, ...clipsAround(view.dom)]);
    const lines = [...range.getClientRects()];
    return shownBox(lines.length === 0 ? [range.getBoundingClientRect()] : lines, seen);
  } catch {
    return undefined;
  }
}

export function turnInto(editor: Editor, block: WritingBlock): void {
  const now = formatOf(editor).block;
  if (now === block) return;
  const chain = editor.chain();
  const between = now !== undefined && LIST_BLOCKS.has(now) && LIST_BLOCKS.has(block);
  TURNS[block](between ? chain : chain.clearNodes()).run();
}

function setLink(editor: Editor, href: string | undefined): void {
  const chain = editor.state.selection.empty
    ? editor.chain().extendMarkRange(MARK_NAMES[WRITING_MARK.LINK])
    : editor.chain();
  (href === undefined ? chain.unsetLink() : chain.setLink({ href })).run();
}

export function editorFormatting(editor: Editor): EditorFormatting {
  return {
    selectionBox: () => selectionBox(editor),
    toggleMark: (mark) => {
      editor.commands.toggleMark(MARK_NAMES[mark]);
    },
    turnInto: (block) => turnInto(editor, block),
    setLink: (href) => setLink(editor, href),
    focus: () => editor.view.focus(),
  };
}

export function formatReports(doors: EditorFormatDoors | undefined): AnyExtension[] {
  if (doors === undefined) return [];
  return [
    Extension.create({
      name: "formatReports",
      onCreate() {
        doors.onFormat(formatOf(this.editor));
      },
      onTransaction() {
        doors.onFormat(formatOf(this.editor));
      },
      addProseMirrorPlugins() {
        const editor = this.editor;
        const answer = keydownHandler({
          [keymapName({ key: SHORTCUT_KEY.K })]: () => {
            const format = formatOf(editor);
            if (format.code || (format.empty && format.link === undefined)) return false;
            doors.onLink();
            return true;
          },
        });
        return [
          new Plugin({
            key: new PluginKey("linkChord"),
            props: {
              handleKeyDown: (view, event) => {
                if (!answer(view, event)) return false;
                event.stopPropagation();
                return true;
              },
            },
          }),
        ];
      },
    }),
  ];
}
