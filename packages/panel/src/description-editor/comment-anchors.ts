import { textChange } from "@repo/features/description-comment-anchor";
import { type Editor, Mark } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorAnchor, EditorAnchors } from "./contract.js";

const COMMENT_ANCHOR = { MARK: "commentAnchor", CLASS: "description-comment-mark" } as const;

const ATOM = "\uFFFC";

export const commentAnchorMark = Mark.create({
  name: COMMENT_ANCHOR.MARK,
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

interface EditorWords {
  readonly text: string;
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

export function anchorsLaidIn(
  editor: Editor,
  markdown: string,
  anchors: readonly EditorAnchor[],
  open: ReadonlySet<string>,
  carried: readonly string[],
): readonly string[] {
  const type = editor.schema.marks[COMMENT_ANCHOR.MARK];
  if (type === undefined) return [];
  const { doc } = editor.state;
  const tr = editor.state.tr.setMeta("addToHistory", false);
  const marked = new Set<string>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      if (mark.type !== type) continue;
      const thread = String(mark.attrs.thread ?? "");
      if (open.has(thread)) marked.add(thread);
      else tr.removeMark(pos, pos + node.nodeSize, mark);
    }
    return false;
  });
  const kept = [...new Set([...carried.filter((thread) => open.has(thread)), ...marked])];
  const fresh = anchors.filter((anchor) => !kept.includes(anchor.thread));
  const words = fresh.length === 0 ? undefined : editorWords(doc);
  const toEditor = words === undefined ? undefined : textChange(markdown, words.text);
  const laid: string[] = [];
  for (const anchor of fresh) {
    const span = toEditor?.(anchor);
    const from = span === undefined ? undefined : words?.at[span.from];
    const last = span === undefined ? undefined : words?.at[span.to - 1];
    if (from === undefined || last === undefined) continue;
    tr.addMark(from, last + 1, type.create({ thread: anchor.thread }));
    laid.push(anchor.thread);
  }
  if (tr.docChanged) editor.view.dispatch(tr);
  return [...kept, ...laid];
}

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

export function spanIn(
  doc: PmNode,
  markdown: string,
  from: number,
  to: number,
): { readonly from: number; readonly to: number } | undefined {
  const words = editorWords(doc);
  const first = words.at.findIndex((pos, index) => pos >= from && words.text[index] !== "\n");
  const last = words.at.findLastIndex((pos, index) => pos < to && words.text[index] !== "\n");
  if (first < 0 || last < first) return undefined;
  return textChange(words.text, markdown)({ from: first, to: last + 1 });
}
