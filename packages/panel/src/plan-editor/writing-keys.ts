/**
 * writing-keys.ts -- the writing chords in a TipTap editor, bound from the one vocabulary (`WRITING_SHORTCUTS`) and nothing else.
 *
 * TipTap's own extensions each bind a chord of their own, two of which are
 * the window's (⇧⌘S Toggle speaker, ⌥⌘C Copy link). `chordless` takes
 * those away from a writing extension, keeping its keys that are no chord
 * (Enter, Tab, Backspace), and `writingKeys` binds the vocabulary's in their
 * place, every one of them or the ones an editor names (`actions`), as a
 * message box names its marks' alone. A block's chord, and a Markdown rule
 * that makes a block (`blockRulesOutOfCells`), does nothing in a table's
 * cell (`inTableCell`, `selectionTouchesCell`), which holds one line of words. A chord the editor answers goes no further than the editor, as the
 * pull request box's own do (`markdown-field.tsx`), so it is the editor's
 * alone while it has the caret and the window's keymap never hears it; every
 * other key, one the editor handled or not, reaches the window as before.
 */

import {
  type ShortcutChord,
  WRITING_ACTIONS,
  WRITING_BLOCK,
  WRITING_INSERT,
  WRITING_MARK,
  WRITING_SHORTCUTS,
  type WritingAction,
  type WritingShortcut,
} from "@luke/settings/shortcuts";
import { type AnyExtension, type Editor, Extension, InputRule } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import type { ResolvedPos } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";

/** The extensions whose own chords the vocabulary's replace, by TipTap's names for them. */
const WRITING_EXTENSIONS: ReadonlySet<string> = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
]);

/** The extensions whose Markdown rules make a block, which a table's cell cannot hold, by TipTap's names for them. */
const BLOCK_RULE_EXTENSIONS: ReadonlySet<string> = new Set([
  "heading",
  "bulletList",
  "orderedList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
]);

/** The writing actions that lay in or turn a block, rather than mark words. */
const BLOCK_ACTIONS: ReadonlySet<WritingAction> = new Set([
  ...Object.values(WRITING_BLOCK),
  ...Object.values(WRITING_INSERT),
]);

/** The roles a table's cells take in ProseMirror's table schema, which TipTap's table cells declare. */
const CELL_ROLES: ReadonlySet<unknown> = new Set(["cell", "header_cell"]);

/** What each writing action does to the editor, answering whether it did it; Link's field is drawn by its caller, so it runs nothing here. */
const WRITING_RUN = {
  [WRITING_MARK.BOLD]: (editor) => editor.commands.toggleBold(),
  [WRITING_MARK.ITALIC]: (editor) => editor.commands.toggleItalic(),
  [WRITING_MARK.STRIKE]: (editor) => editor.commands.toggleStrike(),
  [WRITING_MARK.CODE]: (editor) => editor.commands.toggleCode(),
  [WRITING_BLOCK.TEXT]: (editor) => editor.commands.setParagraph(),
  [WRITING_BLOCK.HEADING_1]: (editor) => editor.commands.toggleHeading({ level: 1 }),
  [WRITING_BLOCK.HEADING_2]: (editor) => editor.commands.toggleHeading({ level: 2 }),
  [WRITING_BLOCK.HEADING_3]: (editor) => editor.commands.toggleHeading({ level: 3 }),
  [WRITING_BLOCK.BULLETED_LIST]: (editor) => editor.commands.toggleBulletList(),
  [WRITING_BLOCK.NUMBERED_LIST]: (editor) => editor.commands.toggleOrderedList(),
  [WRITING_BLOCK.TODO_LIST]: (editor) => editor.commands.toggleTaskList(),
  [WRITING_BLOCK.QUOTE]: (editor) => editor.commands.toggleBlockquote(),
  [WRITING_BLOCK.CODE_BLOCK]: (editor) => editor.commands.toggleCodeBlock(),
  [WRITING_INSERT.DIVIDER]: (editor) => editor.commands.setHorizontalRule(),
} as const satisfies Record<
  Exclude<WritingAction, typeof WRITING_MARK.LINK>,
  (editor: Editor) => boolean
>;

/** Whether the action is one the editor runs itself. */
function runsHere(action: WritingAction): action is keyof typeof WRITING_RUN {
  return Object.hasOwn(WRITING_RUN, action);
}

/**
 * Whether `$at` stands in a table's cell. Note that no block may be laid in
 * or turned there, because a cell of GFM's table is one line of words, so a
 * heading, a list, a quote, code, or a table laid in a cell is lost as the
 * text is saved.
 */
export function inTableCell($at: ResolvedPos): boolean {
  for (let depth = $at.depth; depth > 0; depth -= 1) {
    if (CELL_ROLES.has($at.node(depth).type.spec.tableRole)) return true;
  }
  return false;
}

/** Whether the selection touches a table's cell: the caret stands in one, either end does, or a cell lies between them. */
export function selectionTouchesCell(state: EditorState): boolean {
  const { $from, $to, from, to } = state.selection;
  if (inTableCell($from) || inTableCell($to)) return true;
  let touched = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (CELL_ROLES.has(node.type.spec.tableRole)) touched = true;
    return !touched;
  });
  return touched;
}

/** A chord as ProseMirror's keymap spells it: Mod for Command, so another platform's editor answers Control, as TipTap's own chords do. */
export function keymapName(chord: ShortcutChord): string {
  return ["Mod", chord.option ? "Alt" : undefined, chord.shift ? "Shift" : undefined, chord.key.key]
    .filter((part) => part !== undefined)
    .join("-");
}

/**
 * The extension without the chords TipTap gave it, where it is a writing
 * extension: every key it binds that holds Mod. Its other keys stay, as
 * does every other extension.
 */
function chordless(extension: AnyExtension): AnyExtension {
  if (!WRITING_EXTENSIONS.has(extension.name)) return extension;
  return extension.extend({
    addKeyboardShortcuts() {
      const own = this.parent?.() ?? {};
      return Object.fromEntries(Object.entries(own).filter(([keys]) => !keys.startsWith("Mod-")));
    },
  });
}

/** StarterKit, or any extension that adds others, with each writing extension in it chordless; a writing extension itself made chordless. */
export function withoutTipTapChords(extension: AnyExtension): AnyExtension {
  const own = chordless(extension);
  if (extension.config.addExtensions === undefined) return own;
  return own.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map(withoutTipTapChords);
    },
  });
}

/** The extension with each Markdown rule it has that makes a block doing nothing in a table's cell, where it is one that has such rules. */
function blockRulesOutOfCell(extension: AnyExtension): AnyExtension {
  if (!BLOCK_RULE_EXTENSIONS.has(extension.name)) return extension;
  return extension.extend({
    addInputRules() {
      return (this.parent?.() ?? []).map(
        (rule) =>
          new InputRule({
            find: rule.find,
            handler: (props) =>
              inTableCell(props.state.doc.resolve(props.range.from)) ? null : rule.handler(props),
          }),
      );
    },
  });
}

/** StarterKit, or any extension that adds others, with each Markdown rule in it that makes a block doing nothing in a table's cell. */
export function blockRulesOutOfCells(extension: AnyExtension): AnyExtension {
  const own = blockRulesOutOfCell(extension);
  if (extension.config.addExtensions === undefined) return own;
  return own.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map(blockRulesOutOfCells);
    },
  });
}

/**
 * The vocabulary's chords, each running its action on the editor. Note that
 * a chord the editor answered stops there, because the window's keymap would
 * otherwise run the command sharing its key as well: ⌘B would bold and
 * toggle the sidebar. A block's chord in a table's cell is answered by
 * doing nothing, so it reaches the window no more than it would elsewhere.
 */
export const writingKeys = Extension.create<{ actions: readonly WritingAction[] }>({
  name: "writingKeys",
  addOptions() {
    return { actions: WRITING_ACTIONS };
  },
  addProseMirrorPlugins() {
    const bound: Record<string, () => boolean> = {};
    for (const action of this.options.actions) {
      const shortcut: WritingShortcut = WRITING_SHORTCUTS[action];
      if (shortcut.chord === undefined || !runsHere(action)) continue;
      const block = BLOCK_ACTIONS.has(action);
      bound[keymapName(shortcut.chord)] = () =>
        (block && selectionTouchesCell(this.editor.state)) || WRITING_RUN[action](this.editor);
    }
    const answer = keydownHandler(bound);
    return [
      new Plugin({
        key: new PluginKey("writingKeys"),
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
});
