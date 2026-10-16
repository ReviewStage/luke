import { TEXT_LINK_CLASS } from "@luke/ui/link-face";
import { QUOTE_CLASS } from "@luke/ui/quote-face";
import { type AnyExtension, Editor, Extension } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import type {
  MentionNode,
  PlanEditorHandle,
  PlanEditorPictures,
  PlanEditorPlacement,
  PlanEditorProps,
} from "./contract";
import { diagramPreview } from "./diagram-preview";
import {
  documentManager,
  documentMarkdown,
  documentOpened,
  documentTook,
  type HeldSources,
  RawBlock,
  sourcesOf,
} from "./document-source";
import { mentionNode, pastedMention } from "./mention-node";
import {
  copiedPictures,
  droppedPictures,
  laidInPictures,
  pastedPictures,
  pictureNode,
  removedPicture,
  settledPicture,
} from "./picture-node";
import { planMentions } from "./plan-mentions";

/**
 * plan-editor.ts -- a plan's text, edited in place on TipTap, drawn exactly as the document draws it.
 *
 * What the text may hold, and every shortcut for writing it, is TipTap's
 * own: StarterKit, `@tiptap/markdown`, task lists, tables, and pictures
 * (`./picture-node.ts`), each inline in a paragraph even where it stands
 * alone on its line;
 * underline alone is left out, because Markdown cannot store it and the
 * document could not draw it. A heading wears the read view's own class and
 * level, so the editor's words stand where the drawn words stood and opening
 * the text moves nothing. Each untouched block keeps its exact source
 * (`./document-source.ts`). A Mermaid code block stays code, its diagram
 * previewed under it where the panel draws one (`./diagram-preview.ts`).
 * Esc and ⌘↩ finish, naming the section the caret
 * stood in; ↑ on the text's first line goes to the title above it.
 */

/** The key code a browser gives a key an input method takes. */
const COMPOSING_KEY_CODE = 229;

/** The class the editor's own element wears beside the read view's, which `planning.css` styles. */
const EDITOR_CLASS = "plan-document-text";

/** The heading levels that open a section, as `planSections` counts them. */
const SECTION_LEVELS = new Set([1, 2]);

/** A heading in the read view's own look: its class and its level, which the document's styles key on. */
const DocumentHeading = Heading.extend({
  renderHTML({ node }) {
    const level = Number(node.attrs.level);
    return [`h${level}`, { class: "markdown-heading", "data-level": String(level) }, 0];
  },
});

/**
 * A paragraph that keeps a picture standing alone on its line as its one
 * inline child. Note that TipTap's own unwraps such a picture into a block,
 * which a plan's inline image cannot be, so the document opened invalid and
 * the first edit beside the picture threw; every other paragraph reads as
 * TipTap's does.
 */
const DocumentParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0]?.type === "image") {
      return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    }
    return this.parent?.(token, helpers) ?? [];
  },
});

/** The class a link whose target names a mention wears in the editor, which `planning.css` draws in a chip's light look. */
const MENTION_LINK_CLASS = "plan-mention-link";

/**
 * How a link looks in the editor: a link whose target names a mention,
 * which the read view draws as its chip, wears a chip's light look, so
 * opening a section to edit it does not turn its chips into underlined
 * words; any other is the plain link every place draws (`TEXT_LINK_CLASS`).
 * Note that one attribute decides between the two, so a mention's link
 * never wears the plain link's class beside its own, that only a class is
 * added, never the target in an attribute of its own, and that the
 * attribute is drawn alone and never read or written as markdown.
 */
function linkLook(namesMention: ((target: string) => boolean) | undefined) {
  return Extension.create({
    name: "linkLook",
    addGlobalAttributes() {
      return [
        {
          types: ["link"],
          attributes: {
            look: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes) => ({
                class:
                  namesMention?.(String(attributes.href ?? "")) === true
                    ? MENTION_LINK_CLASS
                    : TEXT_LINK_CLASS,
              }),
            },
          },
        },
      ];
    },
  });
}

/**
 * What the text may hold, read and written as the editor reads and writes
 * it: the mention among the rest, drawn by the panel where it can draw one,
 * a link naming one in a chip's light look where the panel says which, and
 * every other link a plain one.
 */
export function markdownExtensions(
  drawMention?: ((element: HTMLElement, mention: MentionNode) => () => void) | undefined,
  namesMention?: ((target: string) => boolean) | undefined,
  pictures?: PlanEditorPictures | undefined,
): AnyExtension[] {
  const kit = StarterKit.configure({
    blockquote: { HTMLAttributes: { class: QUOTE_CLASS } },
    heading: false,
    paragraph: false,
    underline: false,
    trailingNode: false,
    link: { openOnClick: false },
  });
  return [
    kit,
    DocumentParagraph,
    DocumentHeading,
    Markdown,
    TaskList,
    TaskItem,
    TableKit,
    pictureNode(pictures),
    RawBlock,
    mentionNode(drawMention),
    linkLook(namesMention),
  ];
}

/** Whether a top-level block opens a section. */
function opensSection(node: PmNode): boolean {
  return node.type.name === "heading" && SECTION_LEVELS.has(Number(node.attrs.level));
}

/** The top-level index each section starts at: the first block, and each heading after it that opens one. */
function sectionStarts(doc: PmNode): number[] {
  const starts: number[] = [0];
  doc.forEach((node, _offset, index) => {
    if (index > 0 && opensSection(node)) starts.push(index);
  });
  return starts;
}

/** The section the caret stands in. */
function caretSection(editor: Editor): number {
  const index = editor.state.selection.$from.index(0);
  return sectionStarts(editor.state.doc).filter((start) => start <= index).length - 1;
}

/** Where the caret goes as the editor opens. */
function placed(editor: Editor, placement: PlanEditorPlacement | undefined): Selection {
  const { doc } = editor.state;
  if (placement === undefined) return Selection.atStart(doc);
  if ("x" in placement) {
    const point = editor.view.posAtCoords({ left: placement.x, top: placement.y });
    return point === null ? Selection.atStart(doc) : TextSelection.near(doc.resolve(point.pos));
  }
  const starts = sectionStarts(doc);
  const next = starts[placement.section + 1];
  let end = doc.content.size;
  if (next !== undefined) {
    end = 0;
    doc.forEach((_node, offset, index) => {
      if (index === next) end = offset;
    });
  }
  return TextSelection.near(doc.resolve(end), -1);
}

/**
 * The text's editor mounted into `host`, in place of its drawn sections, its
 * caret where the placement says, and focused if it is asked to be.
 */
export function mountPlanEditor(host: HTMLElement, props: PlanEditorProps): PlanEditorHandle {
  const {
    markdown,
    placement,
    focus,
    label,
    className,
    onDraft,
    onFinish,
    onLeaveUp,
    mentions,
    drawDiagram,
    pictures,
  } = props;
  const extensions = markdownExtensions(mentions?.drawMention, mentions?.namesMention, pictures);
  const manager = documentManager(extensions);
  // Filled once the editor is built, since a block's source is known by the node it opened as.
  let held: HeldSources = { sources: new Map(), lead: "", ending: "" };
  const picking =
    mentions === undefined
      ? undefined
      : planMentions(manager, (node) => held.sources.get(node), mentions);
  const opened = documentOpened(manager, markdown);
  held = { sources: new Map(), lead: opened.lead, ending: opened.ending };
  const editor: Editor = new Editor({
    element: host,
    extensions: [
      ...extensions,
      Placeholder.configure({ placeholder: "Write the plan" }),
      ...(drawDiagram === undefined ? [] : [diagramPreview(drawDiagram)]),
    ],
    content: opened.content,
    contentType: "json",
    editorProps: {
      attributes: {
        class: `${className} ${EDITOR_CLASS}`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
      // Note that image files pasted are laid in as pictures, and an address of Luke's own or a page of an integration's pasted whole as its mention, as the box lays it in.
      handlePaste: (view, event) => {
        if (pictures !== undefined && pastedPictures(view, event, pictures)) return true;
        return mentions === undefined ? false : pastedMention(view, event, mentions.pasted);
      },
      handleDrop: (view, event, _slice, moved) =>
        pictures === undefined ? false : droppedPictures(view, event, moved, pictures),
      transformPasted: (slice) =>
        pictures === undefined ? slice : copiedPictures(slice, pictures),
      handleKeyDown: (view, event) => {
        // A key an input method is composing with is its own: its Enter confirms its words, its Escape drops them.
        if (event.isComposing || view.composing || event.keyCode === COMPOSING_KEY_CODE) {
          return false;
        }
        // The keys a mention's list takes are its own first, Escape among them, which closes it.
        if (mentions?.onKey(event) === true) return true;
        if (event.key === "Escape" || (event.key === "Enter" && event.metaKey)) {
          onFinish(caretSection(editor));
          return true;
        }
        const { selection } = view.state;
        const first = selection.empty && selection.$from.index(0) === 0;
        if (event.key !== "ArrowUp" || !first || !view.endOfTextblock("up")) return false;
        onLeaveUp();
        return true;
      },
    },
    onUpdate: ({ editor: updated }) => onDraft(documentMarkdown(manager, updated.state.doc, held)),
  });
  if (picking !== undefined) editor.registerPlugin(picking.plugin);
  held = sourcesOf(editor.state.doc, opened);
  editor.view.dispatch(editor.state.tr.setSelection(placed(editor, placement)));
  if (focus) editor.view.focus();
  return {
    take: (sent, merged) => {
      const answer = documentTook(editor, manager, held, sent, merged);
      held = answer.held;
      return { base: answer.base, text: documentMarkdown(manager, editor.state.doc, held) };
    },
    chooseMention: (mention) => picking?.choose(editor, mention),
    markdown: () => documentMarkdown(manager, editor.state.doc, held),
    insertPictures: (files) => {
      if (pictures !== undefined) laidInPictures(editor.view, files, pictures);
    },
    settlePicture: (upload, src) => settledPicture(editor.view, upload, src),
    removePicture: (upload) => removedPicture(editor.view, upload),
    destroy: () => editor.destroy(),
  };
}
