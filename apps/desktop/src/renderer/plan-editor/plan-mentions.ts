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
import type { ComposerTrigger, MentionNode, PlanEditorMentions } from "./contract";
import { MENTION_NODE } from "./mention-node";

/**
 * plan-mentions.ts -- the plan editor's `@`: the word the caret ends reported to the panel, the mention it picks written in its place, and a mention of a heading the developer renames named again with the new words.
 *
 * An `@` at the start of a word, outside code, opens the panel's list
 * (`onTrigger`): the word runs from the `@` to the caret, up to four words
 * of its own, since a section's heading has spaces in it. A pick replaces the
 * word with the mention's node and a space (`chooseMention`), the caret
 * after the space. The keys the list takes are the panel's first
 * (`../plan-editor.ts`'s `handleKeyDown`).
 *
 * A section is named by its heading's words, so renaming a heading in the
 * editor would leave the text's own mentions of it naming nothing. Each
 * change that edits a section's heading in place, the heading still the
 * block it was, renames every mention of the old words to the new ones in
 * the same change, which the panel answers target by target (`retarget`),
 * since only it reads a target. A heading whose old words another heading
 * still holds is no rename, and a heading laid in by Luke's merged answer
 * replaces the block whole, so it is none either.
 */

/** The heading levels that open a section, as `planSections` counts them. */
const SECTION_LEVELS = new Set([1, 2]);

/** What a change that named mentions again is tagged with, so it names none of its own. */
const RETARGETED_META = "luke-plan-retargeted";

/** The `@` word the caret ends: `@`, at the start of a word, then up to four words with no bracket, parenthesis, or `@` in them. */
const MENTION_WORD = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,3})?)$/u;

/** The character an inline node that is no text stands for in its block's words, one position wide as the node is. */
const LEAF_CHARACTER = "￼";

const SPACE = " ";

/** The `@` word the caret ends: the report, and the range a pick replaces. */
interface PlanTrigger {
  readonly trigger: ComposerTrigger;
  readonly from: number;
  readonly to: number;
}

/** What the plugin holds between changes: the word last found, and the report last made. */
interface MentionsState {
  found: PlanTrigger | undefined;
  reported: ComposerTrigger | undefined;
}

/** The `@` word the caret ends in plain text, outside code; nothing while the editor has no caret or the caret ends none. */
function triggerAt(view: EditorView): PlanTrigger | undefined {
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
  return {
    trigger: { start: from, query, rect: { left: box.left, top: box.top, bottom: box.bottom } },
    from,
    to: selection.from,
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

/** A heading's words as the plan's text spells them, its formatting kept, as `planSections` knows a section by. */
function headingWords(manager: MarkdownManager, node: PmNode): string {
  const line = manager.serialize({ type: "doc", content: [node.toJSON()] }).trim();
  return line
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

/** The sections' headings the changes renamed in place, old words to new; none where they renamed none. */
function renamedHeadings(
  manager: MarkdownManager,
  transactions: readonly Transaction[],
  before: PmNode,
  after: PmNode,
): Map<string, string> {
  const standing = new Set<string>();
  after.forEach((node) => {
    if (opensSection(node)) standing.add(headingWords(manager, node));
  });
  const renamed = new Map<string, string>();
  before.forEach((node, offset) => {
    if (!opensSection(node)) return;
    const at = mappedThrough(transactions, offset);
    const now = at === undefined ? null : after.nodeAt(at);
    if (now === null || !opensSection(now)) return;
    const was = headingWords(manager, node);
    const is = headingWords(manager, now);
    if (was !== is && was !== "" && is !== "" && !standing.has(was)) renamed.set(was, is);
  });
  return renamed;
}

/** The change naming each mention of a renamed heading again; nothing where none names one. */
function retargeted(
  state: EditorState,
  renamed: ReadonlyMap<string, string>,
  mentions: PlanEditorMentions,
): Transaction | undefined {
  const tr = state.tr.setMeta(RETARGETED_META, true);
  state.doc.descendants((node, position) => {
    if (node.type.name !== MENTION_NODE) return;
    const target = mentions.retarget(String(node.attrs.target), renamed);
    if (target !== undefined && target !== node.attrs.target) {
      tr.setNodeMarkup(position, undefined, { ...node.attrs, target });
    }
  });
  return tr.docChanged ? tr : undefined;
}

/** The plan editor's mentions: the `@` word reported as the editor's state moves and as it takes or loses the caret, and renamed headings' mentions named again. */
export function planMentions(manager: MarkdownManager, mentions: PlanEditorMentions) {
  const state: MentionsState = { found: undefined, reported: undefined };
  const plugin = new Plugin({
    key: new PluginKey("plan-mentions"),
    appendTransaction: (transactions, before, after) => {
      if (!transactions.some((tr) => tr.docChanged)) return undefined;
      if (transactions.some((tr) => tr.getMeta(RETARGETED_META) === true)) return undefined;
      const renamed = renamedHeadings(manager, transactions, before.doc, after.doc);
      return renamed.size === 0 ? undefined : retargeted(after, renamed, mentions);
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
