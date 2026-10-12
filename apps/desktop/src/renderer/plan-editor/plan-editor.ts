import { type AnyExtension, Editor } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import type { PlanEditorHandle, PlanEditorPlacement, PlanEditorProps } from "./contract";
import {
  documentManager,
  documentMarkdown,
  documentOpened,
  documentTook,
  type HeldSources,
  RawBlock,
  sourcesOf,
} from "./document-source";

/**
 * plan-editor.ts -- a plan's text, edited in place on TipTap, drawn exactly as the document draws it.
 *
 * What the text may hold, and every shortcut for writing it, is TipTap's
 * own: StarterKit, `@tiptap/markdown`, task lists, tables, and images;
 * underline alone is left out, because Markdown cannot store it and the
 * document could not draw it. A heading wears the read view's own class and
 * level, so the editor's words stand where the drawn words stood and opening
 * the text moves nothing. Each untouched block keeps its exact source
 * (`./document-source.ts`). Esc and ⌘↩ finish, naming the section the caret
 * stood in; ↑ on the text's first line goes to the title above it.
 */

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

/** What the text may hold, read and written as the editor reads and writes it. */
export function markdownExtensions(): AnyExtension[] {
  const kit = StarterKit.configure({
    heading: false,
    underline: false,
    trailingNode: false,
    link: { openOnClick: false },
  });
  return [
    kit,
    DocumentHeading,
    Markdown,
    TaskList,
    TaskItem,
    TableKit,
    Image.configure({ inline: true }),
    RawBlock,
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
  const { markdown, placement, focus, label, className, onDraft, onFinish, onLeaveUp } = props;
  const extensions = markdownExtensions();
  const manager = documentManager(extensions);
  const opened = documentOpened(manager, markdown);
  // Filled once the editor is built, since a block's source is known by the node it opened as.
  let held: HeldSources = { sources: new Map(), lead: opened.lead, ending: opened.ending };
  const editor: Editor = new Editor({
    element: host,
    extensions: [...extensions, Placeholder.configure({ placeholder: "Write the plan" })],
    content: opened.content,
    contentType: "json",
    editorProps: {
      attributes: {
        class: `${className} ${EDITOR_CLASS}`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
      handleKeyDown: (view, event) => {
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
  held = sourcesOf(editor.state.doc, opened);
  editor.view.dispatch(editor.state.tr.setSelection(placed(editor, placement)));
  if (focus) editor.view.focus();
  return {
    take: (sent, merged) => {
      const answer = documentTook(editor, manager, held, sent, merged);
      held = answer.held;
      return { base: answer.base, text: documentMarkdown(manager, editor.state.doc, held) };
    },
    destroy: () => editor.destroy(),
  };
}
