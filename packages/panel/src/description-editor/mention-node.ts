import { MENTION_SIGIL, mentionMarkdownLink } from "@repo/features/link-grammar";
import { mentionLinksIn, mentionName } from "@repo/features/mention-link";
import { type Editor, type JSONContent, Node } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { MentionDrawer, MentionNode, MentionNodeDoors } from "./contract.js";

export const MENTION_NODE = "mention";

const LINK_MARK = "link";

export function mentionLink(mention: MentionNode): string {
  return mentionMarkdownLink(mention.name, mention.target);
}

function nodeDoors(editor: Editor, getPos: () => number | undefined): MentionNodeDoors {
  const at = () => (editor.isEditable ? getPos() : undefined);
  const after = (pos: number, tr: Transaction) =>
    tr.setSelection(TextSelection.create(tr.doc, pos + (tr.doc.nodeAt(pos)?.nodeSize ?? 1)));
  return {
    rename: (mention, focus) => {
      const pos = at();
      if (pos === undefined) return;
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        name: mention.name,
        target: mention.target,
      });
      editor.view.dispatch(focus ? after(pos, tr) : tr);
      if (focus) editor.view.focus();
    },
    remove: () => {
      const pos = at();
      if (pos === undefined) return;
      const tr = editor.state.tr.delete(pos, pos + (editor.state.doc.nodeAt(pos)?.nodeSize ?? 1));
      editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos)));
      editor.view.focus();
    },
    focusAfter: () => {
      const pos = at();
      if (pos === undefined) return;
      editor.view.dispatch(after(pos, editor.state.tr));
      editor.view.focus();
    },
  };
}

export function mentionNode(drawMention: MentionDrawer | undefined) {
  const node = Node.create({
    name: MENTION_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    addAttributes() {
      return { name: { default: "", rendered: false }, target: { default: "", rendered: false } };
    },
    renderHTML({ node: held }) {
      return ["span", { "data-chip": MENTION_NODE }, `${MENTION_SIGIL}${String(held.attrs.name)}`];
    },
    renderText({ node: held }) {
      return mentionLink({ name: String(held.attrs.name), target: String(held.attrs.target) });
    },
    renderMarkdown: (held: JSONContent) =>
      mentionLink({
        name: String(held.attrs?.name ?? ""),
        target: String(held.attrs?.target ?? ""),
      }),
  });
  if (drawMention === undefined) return node;
  return node.extend({
    addNodeView() {
      return ({ node: held, editor, getPos }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.dataset.chip = MENTION_NODE;
        const undraw = drawMention(
          dom,
          { name: String(held.attrs.name), target: String(held.attrs.target) },
          nodeDoors(editor, getPos),
        );
        return { dom, ignoreMutation: () => true, destroy: undraw };
      };
    },
  });
}

function linkOf(node: JSONContent): string | undefined {
  if (node.type !== "text") return undefined;
  const href: unknown = node.marks?.find((mark) => mark.type === LINK_MARK)?.attrs?.href;
  return href === undefined || href === null ? undefined : String(href);
}

function mentionsOfRun(content: readonly JSONContent[]): JSONContent[] {
  const read: JSONContent[] = [];
  for (let at = 0; at < content.length; at += 1) {
    const node = content[at];
    if (node === undefined) continue;
    const href = linkOf(node);
    if (href === undefined) {
      read.push(withMentions(node));
      continue;
    }
    let end = at;
    while (end + 1 < content.length && linkOf(content[end + 1] ?? {}) === href) end += 1;
    const words = content
      .slice(at, end + 1)
      .map((each) => each.text ?? "")
      .join("");
    if (words.startsWith(MENTION_SIGIL) && words.length > MENTION_SIGIL.length) {
      read.push({
        type: MENTION_NODE,
        attrs: { name: words.slice(MENTION_SIGIL.length), target: href },
      });
    } else {
      read.push(...content.slice(at, end + 1));
    }
    at = end;
  }
  return read;
}

export function withMentions(node: JSONContent): JSONContent {
  if (node.content === undefined) return node;
  return { ...node, content: mentionsOfRun(node.content) };
}

export interface MentionToken {
  readonly start: number;
  readonly end: number;
  readonly mention: MentionNode;
}

export function mentionTokens(text: string): readonly MentionToken[] {
  return mentionLinksIn(text).map(({ start, end, label, target }) => ({
    start,
    end,
    mention: { name: mentionName(label), target },
  }));
}

export function pastedMention(
  view: EditorView,
  event: ClipboardEvent,
  pasted: (words: string) => MentionNode | undefined,
): boolean {
  const mention = pasted(event.clipboardData?.getData("text/plain") ?? "");
  const { $from } = view.state.selection;
  if (mention === undefined || $from.parent.type.spec.code === true) return false;
  if ($from.marks().some((mark) => mark.type.spec.code === true)) return false;
  const { schema } = view.state;
  const node = schema.node(MENTION_NODE, { name: mention.name, target: mention.target });
  view.dispatch(view.state.tr.replaceSelectionWith(node, false).insertText(" ").scrollIntoView());
  return true;
}
