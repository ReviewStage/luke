import {
  type ShortcutChord,
  WRITING_ACTIONS,
  WRITING_BLOCK,
  WRITING_INSERT,
  WRITING_MARK,
  WRITING_SHORTCUTS,
  type WritingAction,
  type WritingShortcut,
} from "@repo/settings/shortcuts";
import { type AnyExtension, type Editor, Extension, InputRule } from "@tiptap/core";
import { keydownHandler } from "@tiptap/pm/keymap";
import type { ResolvedPos } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";

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

const BLOCK_RULE_EXTENSIONS: ReadonlySet<string> = new Set([
  "heading",
  "bulletList",
  "orderedList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
]);

const BLOCK_ACTIONS: ReadonlySet<WritingAction> = new Set([
  ...Object.values(WRITING_BLOCK),
  ...Object.values(WRITING_INSERT),
]);

const CELL_ROLES: ReadonlySet<unknown> = new Set(["cell", "header_cell"]);

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

function runsHere(action: WritingAction): action is keyof typeof WRITING_RUN {
  return Object.hasOwn(WRITING_RUN, action);
}

export function inTableCell($at: ResolvedPos): boolean {
  for (let depth = $at.depth; depth > 0; depth -= 1) {
    if (CELL_ROLES.has($at.node(depth).type.spec.tableRole)) return true;
  }
  return false;
}

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

export function keymapName(chord: ShortcutChord): string {
  return ["Mod", chord.option ? "Alt" : undefined, chord.shift ? "Shift" : undefined, chord.key.key]
    .filter((part) => part !== undefined)
    .join("-");
}

function chordless(extension: AnyExtension): AnyExtension {
  if (!WRITING_EXTENSIONS.has(extension.name)) return extension;
  return extension.extend({
    addKeyboardShortcuts() {
      const own = this.parent?.() ?? {};
      return Object.fromEntries(Object.entries(own).filter(([keys]) => !keys.startsWith("Mod-")));
    },
  });
}

export function withoutTipTapChords(extension: AnyExtension): AnyExtension {
  const own = chordless(extension);
  if (extension.config.addExtensions === undefined) return own;
  return own.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map(withoutTipTapChords);
    },
  });
}

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

export function blockRulesOutOfCells(extension: AnyExtension): AnyExtension {
  const own = blockRulesOutOfCell(extension);
  if (extension.config.addExtensions === undefined) return own;
  return own.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map(blockRulesOutOfCells);
    },
  });
}

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
