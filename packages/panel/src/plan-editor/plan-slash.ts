import { WRITING_BLOCK, WRITING_INSERT } from "@luke/settings/shortcuts";
import type { Editor, JSONContent } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  type ComposerTrigger,
  type PlanEditorBlocks,
  SLASH_INSERT,
  type SlashBlock,
  type SlashChoice,
  sameTrigger,
} from "./contract.js";
import { turnInto } from "./writing-format.js";
import { inTableCell } from "./writing-keys.js";

/**
 * plan-slash.ts -- the plan editor's `/`: the word the caret ends reported to the panel, which draws the block menu over it, and the block it chooses laid in in the word's place.
 *
 * A `/` at the start of a line or after a space, outside code and outside
 * a table's cell, opens the panel's menu (`onTrigger`): the word runs from the `/` to the caret, with
 * no space in it, so a space typed after it ends it and closes the menu.
 * A choice deletes the word, through its end where the caret stands inside
 * it, and runs the block's command on the block the caret stands in
 * (`insert`): a block is set rather than toggled, as Turn into sets it; a
 * diagram is a Mermaid code block; a table is three by three under a
 * header row; a mention lays in the `@` that opens the panel's `@` list;
 * a picture lays in nothing, the panel opening its chooser; and a
 * document's own block lays in the Markdown it names, read as the editor
 * reads its text, in place of the line where the word stood alone on it.
 * The keys the menu takes are the panel's first (`./plan-editor.ts`'s
 * `handleKeyDown`).
 */

/** The `/` word the caret ends: `/`, at the start of the line or after a space, then anything but a space or another `/`. */
const SLASH_WORD = /(^|\s)\/([^\s/]*)$/u;

/** The rest of a `/` word after the caret, which a choice deletes too. */
const WORD_REST = /^[^\s/￼]*/u;

/** The character an inline node that is no text stands for in its block's words, one position wide as the node is. */
const LEAF_CHARACTER = "￼";

/** The language a code block names to be drawn as a diagram, as `./diagram-preview.ts` reads it. */
const DIAGRAM_LANGUAGE = "mermaid";

/** The table a `/table` lays in: three rows by three columns, the first its header. */
const TABLE = { rows: 3, cols: 3, withHeaderRow: true } as const;

/** What a mention's choice lays in, which the `@` list opens on. */
const MENTION_MARK = "@";

/** The `/` word the caret ends: the report, and the range a choice deletes. */
interface SlashWord {
  readonly trigger: ComposerTrigger;
  readonly from: number;
  readonly to: number;
}

/** What the plugin holds between changes: the word last found, and the report last made. */
interface SlashState {
  found: SlashWord | undefined;
  reported: ComposerTrigger | undefined;
}

/** What each block chosen does to the block the caret stands in, its `/` word already deleted. */
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

/** The `/` word the caret ends in plain text, outside code and outside a table's cell; nothing while the editor has no caret or the caret ends none. */
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

/** The `/` word found again, and reported where it changed. */
function reported(view: EditorView, state: SlashState, blocks: PlanEditorBlocks): void {
  state.found = slashAt(view);
  const next = state.found?.trigger;
  if (sameTrigger(next, state.reported)) return;
  state.reported = next;
  blocks.onTrigger(next);
}

/**
 * The plan editor's `/`: the word reported as the editor's state moves and
 * as it takes or loses the caret, and a block chosen laid in in its place,
 * a document's own Markdown read into blocks by `parse`.
 */
export function planSlash(
  blocks: PlanEditorBlocks,
  parse: (markdown: string) => readonly JSONContent[],
) {
  const state: SlashState = { found: undefined, reported: undefined };
  const plugin = new Plugin({
    key: new PluginKey("plan-slash"),
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
  /** The `/` word the caret ends deleted, and `block` run on the block the caret stands in, or a document's own Markdown laid in there. */
  const insert = (editor: Editor, block: SlashChoice): void => {
    const word = state.found;
    if (word === undefined) return;
    editor.chain().focus().deleteRange({ from: word.from, to: word.to }).run();
    if (typeof block === "string") INSERTS[block](editor);
    else editor.commands.insertContent([...parse(block.markdown)]);
  };
  return { plugin, insert };
}
