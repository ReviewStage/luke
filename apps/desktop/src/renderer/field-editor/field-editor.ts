import { Editor, type EditorOptions, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  FIELD_KIND,
  type FieldEditorHandle,
  type FieldEditorProps,
  type FieldValue,
} from "./contract";
import { RULE_EXTENSIONS, ruleDocument, ruleParts } from "./rule-extension";

/**
 * field-editor.ts -- a plan field edited in place on TipTap, drawn exactly as the document draws it.
 *
 * One editor per field, and no section heading in it: the document draws
 * every heading as it does when no field is open, so the fixed template cannot
 * be broken by editing. What a field's Markdown may hold, and every shortcut
 * for writing it, is TipTap's own: StarterKit, `@tiptap/markdown`, task lists,
 * tables, and images. Underline alone is left out, because Markdown cannot
 * store it and the document could not draw it. A rule's fixed shape is the one
 * thing no library knows (`./rule-extension.ts`). The editor wears the read
 * view's classes, so opening a field moves nothing, and a click's point lands
 * the caret on the word it was on. It speaks the words the field editor's
 * model already holds (`./contract.ts`).
 */

/** What an empty field shows, by its kind. */
const PLACEHOLDER = {
  [FIELD_KIND.TEXT]: "Unanswered",
  [FIELD_KIND.QUESTIONS]: "A question",
  [FIELD_KIND.ASSUMPTIONS]: "An assumption",
  [FIELD_KIND.RULE]: "One sentence that holds in every case",
} as const;

/** The class the editor's own element wears beside the read view's, which `planning.css` styles. */
const EDITOR_CLASS = "plan-field-text";

/** The field's words as the editor opens them: Markdown, or a document built as written. */
interface OpenedWords {
  readonly content: JSONContent | string;
  readonly contentType: NonNullable<EditorOptions["contentType"]>;
}

/** What a field may hold. Note that a link opens nothing while it is edited. */
function extensionsOf(kind: FieldValue["kind"], limit: number | undefined) {
  const placeholder = Placeholder.configure({ placeholder: PLACEHOLDER[kind] });
  const bound = CharacterCount.configure({ limit: limit ?? null });
  if (kind === FIELD_KIND.RULE) {
    const inline = StarterKit.configure({
      document: false,
      heading: false,
      blockquote: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      horizontalRule: false,
      underline: false,
      trailingNode: false,
      link: { openOnClick: false },
    });
    return [inline, ...RULE_EXTENSIONS, placeholder, bound];
  }
  // The assumptions' items wear the read view's own class, so they stand where its items stood.
  const item = kind === FIELD_KIND.ASSUMPTIONS ? { class: "plan-assumption" } : {};
  const kit = StarterKit.configure({
    underline: false,
    trailingNode: false,
    heading: { HTMLAttributes: { class: "markdown-heading" } },
    listItem: { HTMLAttributes: item },
    link: { openOnClick: false },
  });
  return [
    kit,
    Markdown,
    TaskList,
    TaskItem,
    TableKit,
    Image.configure({ inline: true }),
    placeholder,
    bound,
  ];
}

/** The field's words as the editor opens on them. */
function contentOf(value: FieldValue): OpenedWords {
  if (value.kind === FIELD_KIND.RULE) {
    return { content: ruleDocument(value.rule), contentType: "json" };
  }
  if (value.kind === FIELD_KIND.TEXT) return { content: value.text, contentType: "markdown" };
  const lines = value.text.split("\n").filter((line) => line.trim() !== "");
  const items = lines.length === 0 ? [""] : lines;
  if (value.kind === FIELD_KIND.QUESTIONS) {
    return { content: items.map((line) => `- ${line}`).join("\n"), contentType: "markdown" };
  }
  // The assumptions are plain text, so they open as written rather than as Markdown.
  const listed = items.map((line) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: line === "" ? [] : [{ type: "text", text: line }] }],
  }));
  return {
    content: { type: "doc", content: [{ type: "bulletList", content: listed }] },
    contentType: "json",
  };
}

/** The editor's words read back as the field holds them. */
function wordsOf(kind: FieldValue["kind"], editor: Editor): FieldValue {
  if (kind === FIELD_KIND.RULE) return { kind, rule: ruleParts(editor) };
  if (kind === FIELD_KIND.ASSUMPTIONS) {
    const items: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "listItem") return true;
      items.push(node.textContent);
      return false;
    });
    return { kind, text: items.join("\n") };
  }
  return { kind, text: editor.getMarkdown() };
}

/**
 * One field's editor mounted into `host`, in place of its drawn words, and
 * focused with its caret where the click landed, since the editor's words
 * stand where the drawn words stood; at the end without a click.
 */
export function mountFieldEditor(host: HTMLElement, props: FieldEditorProps): FieldEditorHandle {
  const { value, at, label, className, limit, onDraft, onFinish } = props;
  const { content, contentType } = contentOf(value);
  const editor = new Editor({
    element: host,
    extensions: extensionsOf(value.kind, limit),
    content,
    contentType,
    editorProps: {
      attributes: {
        class: `${className} ${EDITOR_CLASS}`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape" && !(event.key === "Enter" && event.metaKey)) return false;
        onFinish();
        return true;
      },
    },
    onUpdate: ({ editor: updated }) => onDraft(wordsOf(value.kind, updated)),
  });
  const point = at === undefined ? null : editor.view.posAtCoords({ left: at.x, top: at.y });
  editor.commands.focus(point?.pos ?? "end");
  return { destroy: () => editor.destroy() };
}
