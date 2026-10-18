import type { MentionNode } from "@luke/panel/plan-editor/contract";
import { type JSONContent, Node } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

/**
 * mention-node.ts -- a mention in the editors' words: an atom holding the name it was written with and its link's target, drawn by the panel, written back as the link it was read from.
 *
 * A mention is written into markdown as a link whose label starts with `@`
 * (`@luke/features/mention-link`, which only the panel reads). The editor
 * holds it as one node, an atom one Backspace takes out whole, its name and
 * target in the node and never in the DOM's attributes, since the recording
 * masks words and not every attribute: the chip inside the node's element
 * is the panel's (`drawMention`). Read from markdown, a link whose words
 * start with `@` becomes the node, its formatting, if its label had any,
 * left behind; written back, it is the link again, `[@name](target)`, its
 * label's brackets and backslashes escaped. Nothing here knows what a
 * target names.
 */

export const MENTION_NODE = "mention";

/** What marks a link's words as a mention's. */
const MENTION_SIGIL = "@";

/** The characters a markdown link's label must escape to stay one label. */
const LABEL_SPECIAL = /[[\]\\]/gu;

/** The link mark's name, as StarterKit spells it. */
const LINK_MARK = "link";

/** A mention as markdown writes it. */
export function mentionLink(mention: MentionNode): string {
  const label = `${MENTION_SIGIL}${mention.name}`.replace(
    LABEL_SPECIAL,
    (special) => `\\${special}`,
  );
  return `[${label}](${mention.target})`;
}

/** The mention node: an atom drawn into its own element by the panel where it can draw one, and as its words where it cannot. */
export function mentionNode(
  drawMention: ((element: HTMLElement, mention: MentionNode) => () => void) | undefined,
) {
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
      return ({ node: held }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.dataset.chip = MENTION_NODE;
        const undraw = drawMention(dom, {
          name: String(held.attrs.name),
          target: String(held.attrs.target),
        });
        return { dom, ignoreMutation: () => true, destroy: undraw };
      };
    },
  });
}

/** A text node's link, where it carries one. */
function linkOf(node: JSONContent): string | undefined {
  if (node.type !== "text") return undefined;
  const href: unknown = node.marks?.find((mark) => mark.type === LINK_MARK)?.attrs?.href;
  return href === undefined || href === null ? undefined : String(href);
}

/** One inline run as read: a run of text under one link whose words start with `@` becomes a mention, and anything else stands. */
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
    // Note that a label with formatting in it is read as several runs under the one link.
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

/** A block read from markdown with each link whose words start with `@` made the mention node. */
export function withMentions(node: JSONContent): JSONContent {
  if (node.content === undefined) return node;
  return { ...node, content: mentionsOfRun(node.content) };
}

/** A mention written in plain words: where its link stands, and what it holds. */
export interface MentionToken {
  readonly start: number;
  readonly end: number;
  readonly mention: MentionNode;
}

/** A link whose label starts with `@`: the label's words, its escapes kept, and a target with no space or parenthesis in it. */
const MENTION_LINK = /\[@((?:\\[[\]\\]|[^[\]\\\n])+)\]\(([^\s()]+)\)/gu;

/** A label's escaped character, read back. */
const LABEL_ESCAPE = /\\([[\]\\])/gu;

/** Every mention written in plain words, in order, as the composer reads a message laid in whole: a restored draft or a paste. */
export function mentionTokens(text: string): readonly MentionToken[] {
  return [...text.matchAll(MENTION_LINK)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    mention: { name: (match[1] ?? "").replace(LABEL_ESCAPE, "$1"), target: match[2] ?? "" },
  }));
}

/**
 * A paste whose words the panel reads as one mention, a page of an
 * integration's address, laid in as that mention's node and a space where
 * the caret stands, outside code; answers whether it was, so any other
 * paste goes on as words.
 */
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
