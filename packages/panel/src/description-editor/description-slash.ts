import { WRITING_BLOCK, WRITING_INSERT } from "@repo/settings/shortcuts";
import type { Editor, JSONContent } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  type ComposerTrigger,
  type DescriptionEditorBlocks,
  SLASH_INSERT,
  type SlashBlock,
  type SlashChoice,
  sameTrigger,
} from "./contract.js";
import { turnInto } from "./writing-format.js";
import { inTableCell } from "./writing-keys.js";

const SLASH_WORD = /(^|\s)\/([^\s/]*)$/u;

const WORD_REST = /^[^\s/￼]*/u;

const LEAF_CHARACTER = "￼";

const DIAGRAM_LANGUAGE = "mermaid";

const TABLE = { rows: 3, cols: 3, withHeaderRow: true } as const;

const MENTION_MARK = "@";

interface SlashWord {
  readonly trigger: ComposerTrigger;
  readonly from: number;
  readonly to: number;
}

interface SlashState {
  found: SlashWord | undefined;
  reported: ComposerTrigger | undefined;
}

const INSERTS = {
  [WRITING_BLOCK.TEXT]: (editor) => turnInto(editor, WRITING_BLOCK.TEXT),
  [WRITING_BLOCK.HEADING_1]: (editor) => turnInto(editor, WRITING_BLOCK.HEADING_1),
  [WRITING_BLOCK.HEADING_2]: (editor) => turnInto(editor, WRITING_BLOCK.HEADING_2),
  [WRITING_BLOCK.HEADING_3]: (editor) => turnInto(editor, WRITING_BLOCK.HEADING_3),
  [WRITING_BLOCK.BULLETED_LIST]: (editor) => turnInto(editor, WRITING_BLOCK.BULLETED_LIST),
  [WRITING_BLOCK.NUMBERED_LIST]: (editor) => turnInto(editor, WRITING_BLOCK.NUMBERED_LIST),
  [WRITING_BLOCK.TODO_LIST]: (editor) => turnInto(editor, WRITING_BLOCK.TODO_LIST),
  [WRITING_BLOCK.QUOTE]: (editor) => turnInto(editor, WRITING_BLOCK.QUOTE),
  [WRITING_BLOCK.CODE_BLOCK]: (editor) => turnInto(editor, WRITING_BLOCK.CODE_BLOCK),
  [WRITING_INSERT.DIVIDER]: (editor) => {
    editor.commands.setHorizontalRule();
  },
  [SLASH_INSERT.DIAGRAM]: (editor) => {
    editor.chain().clearNodes().setCodeBlock({ language: DIAGRAM_LANGUAGE }).run();
  },
  [SLASH_INSERT.TABLE]: (editor) => {
    editor.commands.insertTable(TABLE);
  },
  [SLASH_INSERT.PICTURE]: () => undefined,
  [SLASH_INSERT.MENTION]: (editor) => {
    editor.commands.insertContent(MENTION_MARK);
  },
} as const satisfies Record<SlashBlock, (editor: Editor) => void>;

function slashAt(view: EditorView): SlashWord | undefined {
  const { selection, doc } = view.state;
  if (!selection.empty || !view.hasFocus()) return undefined;
  const { $from } = selection;
  if ($from.parent.type.spec.code === true || inTableCell($from)) return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF_CHARACTER);
  const match = SLASH_WORD.exec(before);
  if (match === null) return undefined;
  const query = match[2] ?? "";
  const from = $from.start() + before.length - query.length - 1;
  const coded = doc
    .resolve(from + 1)
    .marks()
    .some((mark) => mark.type.spec.code === true);
  if (coded) return undefined;
  const box = view.coordsAtPos(from);
  const after = $from.parent.textBetween(
    $from.parentOffset,
    $from.parent.content.size,
    undefined,
    LEAF_CHARACTER,
  );
  const rest = WORD_REST.exec(after)?.[0].length ?? 0;
  return {
    trigger: { start: from, query, rect: { left: box.left, top: box.top, bottom: box.bottom } },
    from,
    to: selection.from + rest,
  };
}

function ownBlockAtCaret(editor: Editor, content: readonly JSONContent[]): void {
  const { $to, empty } = editor.state.selection;
  if ($to.depth < 1) {
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, [...content])
      .run();
    return;
  }
  const line = $to.node(1);
  if (empty && line.isTextblock && line.content.size === 0) {
    editor
      .chain()
      .focus()
      .insertContent([...content])
      .run();
    return;
  }
  editor
    .chain()
    .focus()
    .insertContentAt($to.after(1), [...content])
    .run();
}

function reported(view: EditorView, state: SlashState, blocks: DescriptionEditorBlocks): void {
  state.found = slashAt(view);
  const next = state.found?.trigger;
  if (sameTrigger(next, state.reported)) return;
  state.reported = next;
  blocks.onTrigger(next);
}

export function descriptionSlash(
  blocks: DescriptionEditorBlocks,
  parse: (markdown: string) => readonly JSONContent[],
) {
  const state: SlashState = { found: undefined, reported: undefined };
  const plugin = new Plugin({
    key: new PluginKey("description-slash"),
    view: () => ({ update: (view) => reported(view, state, blocks) }),
    props: {
      handleDOMEvents: {
        focus: (view) => {
          reported(view, state, blocks);
          return false;
        },
        blur: (view) => {
          reported(view, state, blocks);
          return false;
        },
      },
    },
  });
  const insert = (editor: Editor, block: SlashChoice): void => {
    const word = state.found;
    if (word === undefined) {
      if (typeof block !== "string") ownBlockAtCaret(editor, parse(block.markdown));
      return;
    }
    editor.chain().focus().deleteRange({ from: word.from, to: word.to }).run();
    if (typeof block === "string") INSERTS[block](editor);
    else editor.commands.insertContent([...parse(block.markdown)]);
  };
  return { plugin, insert };
}
