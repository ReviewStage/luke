import type { Editor } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  type ComposerTrigger,
  type HeadingsChange,
  type MentionNode,
  type DescriptionEditorMentions,
  sameTrigger,
} from "./contract.js";
import { MENTION_NODE } from "./mention-node.js";

const SECTION_LEVELS = new Set([1, 2]);

const RETARGETED_META = "plan-retargeted";

const MENTION_WORD = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,5})?)$/u;

const LEAF_CHARACTER = "￼";

const WORD_REST = /^[^\s@[\]()\uFFFC]*/u;

const SPACE = " ";

interface TaskTrigger {
  readonly trigger: ComposerTrigger;
  readonly from: number;
  readonly to: number;
}

interface MentionsState {
  found: TaskTrigger | undefined;
  reported: ComposerTrigger | undefined;
}

function triggerAt(view: EditorView): TaskTrigger | undefined {
  const { selection, doc } = view.state;
  if (!selection.empty || !view.hasFocus()) return undefined;
  const { $from } = selection;
  if ($from.parent.type.spec.code === true) return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF_CHARACTER);
  const match = MENTION_WORD.exec(before);
  if (match === null) return undefined;
  const query = match[2] ?? "";
  const from = $from.start() + before.length - query.length - 1;
  if (
    doc
      .resolve(from + 1)
      .marks()
      .some((mark) => mark.type.spec.code === true)
  )
    return undefined;
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

function reported(
  view: EditorView,
  state: MentionsState,
  mentions: DescriptionEditorMentions,
): void {
  state.found = triggerAt(view);
  const next = state.found?.trigger;
  if (sameTrigger(next, state.reported)) return;
  state.reported = next;
  mentions.onTrigger(next);
}

function opensSection(node: PmNode): boolean {
  return node.type.name === "heading" && SECTION_LEVELS.has(Number(node.attrs.level));
}

function headingWords(
  manager: MarkdownManager,
  sourceOf: (node: PmNode) => string | undefined,
  node: PmNode,
): string {
  const line =
    sourceOf(node)?.split("\n")[0] ?? manager.serialize({ type: "doc", content: [node.toJSON()] });
  return line
    .trim()
    .replace(/^#{1,6}\s+/u, "")
    .replace(/\s+#+$/u, "")
    .trim();
}

function mappedThrough(transactions: readonly Transaction[], position: number): number | undefined {
  let at = position;
  for (const tr of transactions) {
    const mapped = tr.mapping.mapResult(at, 1);
    if (mapped.deletedAfter) return undefined;
    at = mapped.pos;
  }
  return at;
}

function headingsChange(
  manager: MarkdownManager,
  sourceOf: (node: PmNode) => string | undefined,
  transactions: readonly Transaction[],
  before: PmNode,
  after: PmNode,
): HeadingsChange | undefined {
  const was: string[] = [];
  const opened = new Map<number, number>();
  before.forEach((node, offset) => {
    if (opensSection(node)) {
      opened.set(offset, was.length);
      was.push(headingWords(manager, sourceOf, node));
    }
  });
  const is: string[] = [];
  const placed = new Map<number, number>();
  after.forEach((node, offset) => {
    if (opensSection(node)) {
      placed.set(offset, is.length);
      is.push(headingWords(manager, sourceOf, node));
    }
  });
  if (was.length === is.length && was.every((heading, at) => heading === is[at])) return undefined;
  const kept = new Map<number, number>();
  for (const [offset, at] of opened) {
    const now = mappedThrough(transactions, offset);
    const place = now === undefined ? undefined : placed.get(now);
    if (place !== undefined) kept.set(at, place);
  }
  return { before: was, after: is, kept };
}

function retargeted(
  state: EditorState,
  change: HeadingsChange,
  mentions: DescriptionEditorMentions,
): Transaction | undefined {
  const tr = state.tr.setMeta(RETARGETED_META, true);
  state.doc.descendants((node, position) => {
    if (node.type.name !== MENTION_NODE) return;
    const named = mentions.retarget(String(node.attrs.target), change);
    if (
      named !== undefined &&
      (named.target !== node.attrs.target || named.name !== node.attrs.name)
    ) {
      tr.setNodeMarkup(position, undefined, { ...node.attrs, ...named });
    }
  });
  return tr.docChanged ? tr : undefined;
}

export function descriptionMentions(
  manager: MarkdownManager,
  sourceOf: (node: PmNode) => string | undefined,
  mentions: DescriptionEditorMentions,
) {
  const state: MentionsState = { found: undefined, reported: undefined };
  const plugin = new Plugin({
    key: new PluginKey("description-mentions"),
    appendTransaction: (transactions, before, after) => {
      if (!transactions.some((tr) => tr.docChanged)) return undefined;
      if (transactions.some((tr) => tr.getMeta(RETARGETED_META) === true)) return undefined;
      const change = headingsChange(manager, sourceOf, transactions, before.doc, after.doc);
      return change === undefined ? undefined : retargeted(after, change, mentions);
    },
    view: () => ({ update: (view) => reported(view, state, mentions) }),
    props: {
      handleDOMEvents: {
        focus: (view) => {
          reported(view, state, mentions);
          return false;
        },
        blur: (view) => {
          reported(view, state, mentions);
          return false;
        },
      },
    },
  });
  const choose = (editor: Editor, mention: MentionNode): void => {
    const word = state.found;
    if (word === undefined) return;
    const { doc, schema } = editor.state;
    const spaced = doc.textBetween(word.to, Math.min(word.to + 1, doc.content.size)) === SPACE;
    const chip = schema.node(MENTION_NODE, { name: mention.name, target: mention.target });
    const tr = editor.state.tr.replaceWith(
      word.from,
      word.to,
      spaced ? [chip] : [chip, schema.text(SPACE)],
    );
    editor.view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, word.from + 2)).scrollIntoView(),
    );
    editor.view.focus();
  };
  return { plugin, choose };
}
