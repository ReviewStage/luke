import { textChange } from "@luke/features/plan-comment-anchor";
import { type Editor, Mark } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorAnchor, EditorAnchors } from "./contract.js";

/**
 * comment-anchors.ts -- the words a comment thread is on, carried in the open editor as a mark, so they move with their words and come back with them on undo.
 *
 * The service keeps a thread's anchor as offsets into the plan's Markdown
 * (`@luke/features/plan-comment-anchor`); the editor holds its words as a
 * mark naming the thread, laid on as the editor opens and outside the
 * developer's undo, so no undo takes them off. From then on the mark is part
 * of the words: typing inside them widens it, deleting them takes it, and
 * undoing the deletion brings it back with them, which no carrying-over of
 * the text alone could tell. Each draft reports where every mark stands in
 * the Markdown the draft is (`anchorsOf`), and the save hands that to the
 * service, which takes it for the threads the editor carried. The mark
 * writes nothing to the Markdown: a mark without a Markdown form is left out
 * of what TipTap prints.
 *
 * Offsets are carried between the Markdown and the editor's words by laying
 * the two texts over each other, so emphasis, links, and chips in between
 * put nothing off.
 */

/** The mark's name, and the class the read view's comment marks wear, which it shares. */
const COMMENT_ANCHOR = { MARK: "commentAnchor", CLASS: "plan-comment-mark" } as const;

/** What stands for an inline node that holds no words, a chip or a picture, in the editor's words. */
const ATOM = "\uFFFC";

/** The words a thread is on, as the editor holds them: a mark naming its thread, drawn as the read view draws one. */
export const commentAnchorMark = Mark.create({
  name: COMMENT_ANCHOR.MARK,
  // Note that two threads may stand on the same words, and that words typed at an anchor's edge are not its.
  excludes: "",
  inclusive: false,
  addAttributes() {
    return {
      thread: {
        default: "",
        renderHTML: (attributes) => ({ "data-threads": String(attributes.thread ?? "") }),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", { ...HTMLAttributes, class: COMMENT_ANCHOR.CLASS }, 0];
  },
});

/** The editor's words in order, a block's end a line break, and where each letter of them stands in the document. */
interface EditorWords {
  readonly text: string;
  /** The document position each letter of `text` stands at. */
  readonly at: readonly number[];
}

function editorWords(doc: PmNode): EditorWords {
  let text = "";
  const at: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      const words = node.text ?? "";
      for (let index = 0; index < words.length; index += 1) at.push(pos + index);
      text += words;
      return false;
    }
    if (node.isInline && node.isAtom) {
      at.push(pos);
      text += ATOM;
      return false;
    }
    if (node.isTextblock && text !== "" && !text.endsWith("\n")) {
      at.push(pos);
      text += "\n";
    }
    return true;
  });
  return { text, at };
}

/**
 * The threads' marks laid on the words their anchors name in `markdown`,
 * the text the editor opened on, outside the developer's undo. Answers the
 * threads it laid a mark for, the ones the editor carries; a thread none of
 * whose words could be found is left to the service to carry.
 */
export function anchorsLaidIn(
  editor: Editor,
  markdown: string,
  anchors: readonly EditorAnchor[],
): readonly string[] {
  const type = editor.schema.marks[COMMENT_ANCHOR.MARK];
  if (type === undefined || anchors.length === 0) return [];
  const words = editorWords(editor.state.doc);
  const toEditor = textChange(markdown, words.text);
  const tr = editor.state.tr.setMeta("addToHistory", false);
  const laid: string[] = [];
  for (const anchor of anchors) {
    const span = toEditor(anchor);
    const from = span === undefined ? undefined : words.at[span.from];
    const last = span === undefined ? undefined : words.at[span.to - 1];
    if (from === undefined || last === undefined) continue;
    tr.addMark(from, last + 1, type.create({ thread: anchor.thread }));
    laid.push(anchor.thread);
  }
  if (laid.length > 0) editor.view.dispatch(tr);
  return laid;
}

/**
 * Where each mark stands in the Markdown the editor would hand over now,
 * `markdown`, from its first letter to its last, and the threads the editor
 * carries: a carried thread with no mark had its words deleted here.
 */
export function anchorsOf(
  doc: PmNode,
  markdown: string,
  carried: readonly string[],
): EditorAnchors {
  const words = editorWords(doc);
  const index = new Map(words.at.map((pos, at) => [pos, at]));
  const spans = new Map<string, { from: number; to: number }>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== COMMENT_ANCHOR.MARK) continue;
      const thread = String(mark.attrs.thread ?? "");
      const from = index.get(pos);
      const to = index.get(pos + node.nodeSize - 1);
      if (thread === "" || from === undefined || to === undefined) continue;
      const was = spans.get(thread);
      spans.set(thread, {
        from: Math.min(was?.from ?? from, from),
        to: Math.max(was?.to ?? to + 1, to + 1),
      });
    }
    return false;
  });
  const toMarkdown = textChange(words.text, markdown);
  const anchors = [...spans].flatMap(([thread, span]) => {
    const moved = toMarkdown(span);
    return moved === undefined ? [] : [{ thread, ...moved }];
  });
  return { anchors, carried };
}

/**
 * Where the editor's document stretch from `from` to `to` stands in
 * `markdown`, the text the editor would hand over now, from its first letter
 * to its last: what a thread started on the editor's words is anchored to.
 * Nothing where the stretch holds no letter the text keeps.
 */
export function spanIn(
  doc: PmNode,
  markdown: string,
  from: number,
  to: number,
): { readonly from: number; readonly to: number } | undefined {
  const words = editorWords(doc);
  // Note that a block's break, written where the block starts, is no letter of the stretch's.
  const first = words.at.findIndex((pos, index) => pos >= from && words.text[index] !== "\n");
  const last = words.at.findLastIndex((pos, index) => pos < to && words.text[index] !== "\n");
  if (first < 0 || last < first) return undefined;
  return textChange(words.text, markdown)({ from: first, to: last + 1 });
}
