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
import type {
  ComposerTrigger,
  HeadingsChange,
  MentionNode,
  PlanEditorMentions,
} from "./contract.js";
import { MENTION_NODE } from "./mention-node.js";

/**
 * plan-mentions.ts -- the plan editor's `@`: the word the caret ends reported to the panel, the mention it picks written in its place, and a mention of a heading the developer renames named again with the new words.
 *
 * An `@` at the start of a word, outside code, opens the panel's list
 * (`onTrigger`): the word runs from the `@` to the caret, up to six words
 * of its own, since a section's heading has spaces in it, and a date's
 * range runs as long as `next fri at 3pm to 5pm`. A pick replaces the
 * word with the mention's node and a space (`chooseMention`), the caret
 * after the space. The keys the list takes are the panel's first
 * (`../plan-editor.ts`'s `handleKeyDown`).
 *
 * A section is named by its heading's anchor, so renaming a heading in the
 * editor, or laying in one that a later heading's anchor now has to step
 * aside for, would leave the text's own mentions of it naming nothing, or
 * the wrong section. Each change that moves the text's headings hands the
 * panel the headings before and after it and which section each kept one
 * is now, its heading still the block it was, and the panel names every
 * mention of a section whose anchor moved again, target by target
 * (`retarget`), in the same change, since only it reads a target. A
 * heading laid in by Luke's merged answer replaces the block whole, so the
 * section it opened is none the change kept.
 */

/** The heading levels that open a section, as `planSections` counts them. */
const SECTION_LEVELS = new Set([1, 2]);

/** What a change that named mentions again is tagged with, so it names none of its own. */
const RETARGETED_META = "luke-plan-retargeted";

/** The `@` word the caret ends: `@`, at the start of a word, then up to six words with no bracket, parenthesis, or `@` in them. */
const MENTION_WORD = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,5})?)$/u;

/** The character an inline node that is no text stands for in its block's words, one position wide as the node is. */
const LEAF_CHARACTER = "￼";

/** The rest of an `@` word after the caret, which a pick replaces too: up to a space, a bracket, a parenthesis, an `@`, or a chip, which is no word's. */
const WORD_REST = /^[^\s@[\]()\uFFFC]*/u;

const SPACE = " ";

/** The `@` word the caret ends: the report, and the range a pick replaces. */
interface TaskTrigger {
  readonly trigger: ComposerTrigger;
  readonly from: number;
  readonly to: number;
}

/** What the plugin holds between changes: the word last found, and the report last made. */
interface MentionsState {
  found: TaskTrigger | undefined;
  reported: ComposerTrigger | undefined;
}

/** The `@` word the caret ends in plain text, outside code; nothing while the editor has no caret or the caret ends none. */
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
  // Note that a pick with the caret inside the word replaces the word through its end.
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

/** Whether two reports say the same, so an unchanged word is not reported again. */
function sameTrigger(a: ComposerTrigger | undefined, b: ComposerTrigger | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.start === b.start &&
    a.query === b.query &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.bottom === b.rect.bottom
  );
}

/** The `@` word found again, and reported where it changed. */
function reported(view: EditorView, state: MentionsState, mentions: PlanEditorMentions): void {
  state.found = triggerAt(view);
  const next = state.found?.trigger;
  if (sameTrigger(next, state.reported)) return;
  state.reported = next;
  mentions.onTrigger(next);
}

/** Whether a top-level block opens a section. */
function opensSection(node: PmNode): boolean {
  return node.type.name === "heading" && SECTION_LEVELS.has(Number(node.attrs.level));
}

/**
 * A heading's words as the plan's text spells them, its formatting kept, as
 * `planSections` knows a section by: the block's own source while it is the
 * block it opened as, so `_today_` stays `_today_`, else as the editor will
 * write it.
 */
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

/** Where a position stands after every change, or nothing where the block after it went. */
function mappedThrough(transactions: readonly Transaction[], position: number): number | undefined {
  let at = position;
  for (const tr of transactions) {
    const mapped = tr.mapping.mapResult(at, 1);
    if (mapped.deletedAfter) return undefined;
    at = mapped.pos;
  }
  return at;
}

/**
 * The headings before the changes and after them, and which section each
 * kept heading opens now; nothing where the changes left the headings as
 * they were.
 */
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

/** The change naming each mention of a section whose anchor moved again; nothing where none names one. */
function retargeted(
  state: EditorState,
  change: HeadingsChange,
  mentions: PlanEditorMentions,
): Transaction | undefined {
  const tr = state.tr.setMeta(RETARGETED_META, true);
  state.doc.descendants((node, position) => {
    if (node.type.name !== MENTION_NODE) return;
    const target = mentions.retarget(String(node.attrs.target), change);
    if (target !== undefined && target !== node.attrs.target) {
      tr.setNodeMarkup(position, undefined, { ...node.attrs, target });
    }
  });
  return tr.docChanged ? tr : undefined;
}

/** The plan editor's mentions: the `@` word reported as the editor's state moves and as it takes or loses the caret, and renamed headings' mentions named again. */
export function planMentions(
  manager: MarkdownManager,
  sourceOf: (node: PmNode) => string | undefined,
  mentions: PlanEditorMentions,
) {
  const state: MentionsState = { found: undefined, reported: undefined };
  const plugin = new Plugin({
    key: new PluginKey("plan-mentions"),
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
  /** The `@` word the caret ends written as the mention chosen, a space after it unless one follows, the caret after the space. */
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
