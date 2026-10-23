/**
 * writing-format.ts -- the selection as a format toolbar reads it, and what the toolbar's presses do to it, in any of the panel's TipTap editors.
 *
 * The toolbar is the panel's (`../tasks/selection-toolbar.tsx`), which hears
 * the selection after every change through the doors it hands the editor
 * (`EditorFormatDoors`) and acts on it through the editor's handle
 * (`EditorFormatting`). A mark is TipTap's own; a block a selection is
 * turned into is laid on the plain paragraphs its blocks become first, so
 * Turn into sets a block rather than toggling it, and a list turned into
 * another kind of list keeps its items as they nest. ⌘K is the editor's only
 * over selected words or in a link, where the owner opens its link field,
 * and goes on to the window's command palette anywhere else.
 */

import {
  SHORTCUT_KEY,
  WRITING_BLOCK,
  WRITING_MARK,
  type WritingBlock,
  type WritingMark,
} from "@luke/settings/shortcuts";
import { type AnyExtension, type ChainedCommands, type Editor, Extension } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorBox, EditorFormat, EditorFormatDoors, EditorFormatting } from "./contract.js";
import { keymapName } from "./writing-keys.js";

/** Each writing mark by TipTap's name for it. */
const MARK_NAMES = {
  [WRITING_MARK.BOLD]: "bold",
  [WRITING_MARK.ITALIC]: "italic",
  [WRITING_MARK.STRIKE]: "strike",
  [WRITING_MARK.CODE]: "code",
  [WRITING_MARK.LINK]: "link",
} as const satisfies Record<WritingMark, string>;

/** The writing marks, in the vocabulary's order. */
const WRITING_MARKS: readonly WritingMark[] = Object.values(WRITING_MARK);

/** The block a paragraph stands as inside each node that wraps one, by TipTap's name for the node; the innermost decides. */
const WRAPPING_BLOCKS: ReadonlyMap<string, WritingBlock> = new Map([
  ["taskList", WRITING_BLOCK.TODO_LIST],
  ["bulletList", WRITING_BLOCK.BULLETED_LIST],
  ["orderedList", WRITING_BLOCK.NUMBERED_LIST],
  ["blockquote", WRITING_BLOCK.QUOTE],
]);

/** The heading levels the vocabulary names, each its block. */
const HEADING_BLOCKS: ReadonlyMap<number, WritingBlock> = new Map([
  [1, WRITING_BLOCK.HEADING_1],
  [2, WRITING_BLOCK.HEADING_2],
  [3, WRITING_BLOCK.HEADING_3],
]);

/** The blocks that are lists, one of which turns into another in place. */
const LIST_BLOCKS: ReadonlySet<WritingBlock> = new Set([
  WRITING_BLOCK.BULLETED_LIST,
  WRITING_BLOCK.NUMBERED_LIST,
  WRITING_BLOCK.TODO_LIST,
]);

/** What turns plain paragraphs into each block, or a list into another kind of list. */
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

/** The block the text block at `$at` stands as: a heading or code by its own kind, a paragraph by what wraps it; none for a heading the vocabulary has no name for. */
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

/** The blocks of every text block the selection touches, the caret's own where it touches none. */
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

/** The selection as a format toolbar reads it now. */
export function formatOf(editor: Editor): EditorFormat {
  const { from, to, empty } = editor.state.selection;
  const blocks = selectedBlocks(editor);
  const linked = editor.isActive(MARK_NAMES[WRITING_MARK.LINK]);
  const href: unknown = editor.getAttributes(MARK_NAMES[WRITING_MARK.LINK]).href;
  return {
    from,
    to,
    empty,
    code: blocks.has(WRITING_BLOCK.CODE_BLOCK),
    marks: WRITING_MARKS.filter((mark) => editor.isActive(MARK_NAMES[mark])),
    block: blocks.size === 1 ? [...blocks][0] : undefined,
    link: linked && typeof href === "string" ? href : undefined,
  };
}

/** Where the selected words stand in the window, every line of them; none where they cannot be measured. */
function selectionBox(editor: Editor): EditorBox | undefined {
  const { view, state } = editor;
  try {
    const start = view.domAtPos(state.selection.from);
    const end = view.domAtPos(state.selection.to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const { left, top, right, bottom } = range.getBoundingClientRect();
    return { left, top, right, bottom };
  } catch {
    // Note that a position the view cannot find in its own nodes measures nothing.
    return undefined;
  }
}

/** The blocks the selection stands in turned into `block`: a list into another list in place, anything else through plain paragraphs. */
function turnInto(editor: Editor, block: WritingBlock): void {
  const now = formatOf(editor).block;
  if (now === block) return;
  const chain = editor.chain();
  const between = now !== undefined && LIST_BLOCKS.has(now) && LIST_BLOCKS.has(block);
  TURNS[block](between ? chain : chain.clearNodes()).run();
}

/** The selected words, or the whole link the caret stands in, linked to `href`, or unlinked where it is none. */
function setLink(editor: Editor, href: string | undefined): void {
  const chain = editor.chain().extendMarkRange(MARK_NAMES[WRITING_MARK.LINK]);
  (href === undefined ? chain.unsetLink() : chain.setLink({ href })).run();
}

/** What a format toolbar does to the editor through its handle. */
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

/**
 * The selection told to a format toolbar after every change, and ⌘K over
 * selected words or in a link handed to its link field; nothing where no
 * toolbar stands over the editor. Note that a ⌘K the editor answered goes
 * no further, as a writing chord does (`./writing-keys.ts`), and that one
 * over no words and in no link is left to the window, whose command
 * palette it opens.
 */
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
