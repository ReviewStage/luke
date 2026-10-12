// field-editor.ts -- SPIKE: a plan field edited in place on TipTap, drawn as the document draws it; the body of the field editor's own bundle.

import { Editor, type JSONContent } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import {
  FIELD_KIND,
  type FieldEditorHandle,
  type FieldEditorProps,
  type FieldValue,
} from "./field-editor-contract";
import { RULE_EXTENSIONS, ruleDocument, ruleParts } from "./rule-extension";

/**
 * SPIKE, not production code. One TipTap editor per field, and no heading in
 * it: the document draws every heading as it does today, so the fixed
 * template cannot be broken by editing. Everything a field's Markdown can
 * hold, and every shortcut for writing it, is TipTap's own: StarterKit,
 * `@tiptap/markdown`, task lists, tables, and images. The editor speaks the
 * words `plan-field-editor-model.ts` already holds: a text field's Markdown,
 * a list one item a line, a rule's parts.
 */

const PLACEHOLDER = {
  [FIELD_KIND.TEXT]: "Unanswered",
  [FIELD_KIND.QUESTIONS]: "A question",
  [FIELD_KIND.ASSUMPTIONS]: "An assumption",
  [FIELD_KIND.RULE]: "One sentence that holds in every case",
} as const;

/** The grammars code blocks are highlighted with, the same set the read view highlights with (`markdown-message.tsx`). */
const lowlight = createLowlight(common);

/**
 * What a field's Markdown may hold: everything StarterKit and TipTap's
 * Markdown-backed extensions give, but underline, which Markdown cannot
 * store and the read view could not draw. Note that a link opens nothing
 * while it is edited, and code blocks are TipTap's highlighted ones.
 */
function extensionsOf(kind: FieldValue["kind"]) {
  const placeholder = Placeholder.configure({ placeholder: PLACEHOLDER[kind] });
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
    return [inline, ...RULE_EXTENSIONS, placeholder];
  }
  // The assumptions' items wear the read view's own class, so they stand where its items stood.
  const item = kind === FIELD_KIND.ASSUMPTIONS ? { class: "plan-assumption" } : {};
  const kit = StarterKit.configure({
    underline: false,
    trailingNode: false,
    codeBlock: false,
    heading: { HTMLAttributes: { class: "markdown-heading" } },
    listItem: { HTMLAttributes: item },
    link: { openOnClick: false },
  });
  return [
    kit,
    Markdown,
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem,
    TableKit,
    Image.configure({ inline: true }),
    placeholder,
  ];
}

/** The field's words as the editor opens them: Markdown, or a document built as written. */
interface OpenedWords {
  readonly content: JSONContent | string;
  readonly contentType: "markdown" | "json";
}

/** The field's words as the editor opens on them. */
function contentOf(value: FieldValue): OpenedWords {
  if (value.kind === FIELD_KIND.RULE)
    return { content: ruleDocument(value.rule), contentType: "json" };
  if (value.kind === FIELD_KIND.TEXT) return { content: value.text, contentType: "markdown" };
  const lines = value.text.split("\n").filter((line) => line.trim() !== "");
  if (value.kind === FIELD_KIND.QUESTIONS) {
    return {
      content: (lines.length === 0 ? [""] : lines).map((line) => `- ${line}`).join("\n"),
      contentType: "markdown",
    };
  }
  // The assumptions are plain text, so they open as written rather than as Markdown.
  const items = (lines.length === 0 ? [""] : lines).map((line) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: line === "" ? [] : [{ type: "text", text: line }] }],
  }));
  return {
    content: { type: "doc", content: [{ type: "bulletList", content: items }] },
    contentType: "json",
  };
}

/** The editor's words read back as the field holds them. */
function fieldWordsOf(kind: FieldValue["kind"], editor: Editor): FieldValue {
  if (kind === FIELD_KIND.RULE) return { kind, rule: ruleParts(editor) };
  if (kind === FIELD_KIND.ASSUMPTIONS)
    return { kind, text: editor.getText({ blockSeparator: "\n" }) };
  return { kind, text: editor.getMarkdown() };
}

/**
 * One field's editor mounted into `host`, in place of its drawn words, and
 * focused with its caret where the click landed, since the editor's words
 * stand where the drawn words stood.
 */
export function mountFieldEditor(host: HTMLElement, props: FieldEditorProps): FieldEditorHandle {
  const { value, at, label, className, onDraft, onFinish } = props;
  const { content, contentType } = contentOf(value);
  const editor = new Editor({
    element: host,
    extensions: extensionsOf(value.kind),
    content,
    contentType,
    editorProps: {
      attributes: {
        class: `${className} spike-editor`,
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
    onUpdate: ({ editor: updated }) => onDraft(fieldWordsOf(value.kind, updated)),
  });
  const pos =
    at === undefined ? undefined : editor.view.posAtCoords({ left: at.x, top: at.y })?.pos;
  editor.commands.focus(pos ?? "end");
  return { destroy: () => editor.destroy() };
}
