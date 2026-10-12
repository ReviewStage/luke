// field-editor.tsx -- SPIKE: a plan field edited in place on TipTap, drawn as the document draws it.

import type { Editor, JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useLayoutEffect, useRef } from "react";
import { RULE_EXTENSIONS, type RuleParts, ruleDocument, ruleParts } from "./rule-extension";

/**
 * SPIKE, not production code. One TipTap editor per field, and no heading in
 * it: the document draws every heading as it does today, so the fixed
 * template cannot be broken by editing. Everything a field's Markdown can
 * hold, and every shortcut for writing it, is TipTap's own: StarterKit,
 * `@tiptap/markdown`, task lists, tables, and images. The editor speaks the
 * words `plan-field-editor-model.ts` already holds: a text field's Markdown,
 * a list one item a line, a rule's parts.
 */

/** The kinds of field, by what the editor reads and writes. */
export const FIELD_KIND = {
  /** A text field's Markdown. */
  TEXT: "text",
  /** The open questions: Markdown items, one a line. */
  QUESTIONS: "questions",
  /** The assumptions: plain items, one a line, since the document draws them as plain text. */
  ASSUMPTIONS: "assumptions",
  RULE: "rule",
} as const;

export type FieldValue =
  | {
      readonly kind: Exclude<(typeof FIELD_KIND)[keyof typeof FIELD_KIND], typeof FIELD_KIND.RULE>;
      readonly text: string;
    }
  | { readonly kind: typeof FIELD_KIND.RULE; readonly rule: RuleParts };

const PLACEHOLDER = {
  [FIELD_KIND.TEXT]: "Unanswered",
  [FIELD_KIND.QUESTIONS]: "A question",
  [FIELD_KIND.ASSUMPTIONS]: "An assumption",
  [FIELD_KIND.RULE]: "One sentence that holds in every case",
} as const;

/** What a field's Markdown may hold. Note that a link opens nothing while it is edited. */
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
  const kit = StarterKit.configure({
    heading: false,
    horizontalRule: false,
    underline: false,
    trailingNode: false,
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
 * One field in its editor, in place of its drawn words. `at` is where the
 * click that opened it landed, which places the caret; the end without one.
 * `onDraft` hears the field's words after each change, `onFinish` Esc or ⌘↩.
 */
export function FieldEditor({
  value,
  at,
  label,
  className,
  onDraft,
  onFinish,
}: {
  value: FieldValue;
  at: { readonly x: number; readonly y: number } | undefined;
  label: string;
  className: string;
  onDraft: (value: FieldValue) => void;
  onFinish: () => void;
}): React.JSX.Element {
  const handlers = useRef({ onDraft, onFinish });
  handlers.current = { onDraft, onFinish };
  const { content, contentType } = contentOf(value);
  const editor = useEditor({
    extensions: extensionsOf(value.kind),
    content,
    contentType,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: `${className} spike-editor`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape" && !(event.key === "Enter" && event.metaKey)) return false;
        handlers.current.onFinish();
        return true;
      },
    },
    onUpdate: ({ editor: updated }) => handlers.current.onDraft(fieldWordsOf(value.kind, updated)),
  });

  // The caret lands where the pointer did, since the editor's words stand where the drawn words stood.
  useLayoutEffect(() => {
    const pos =
      at === undefined ? undefined : editor.view.posAtCoords({ left: at.x, top: at.y })?.pos;
    editor.commands.focus(pos ?? "end");
  }, [editor]);

  return <EditorContent editor={editor} className="ph-no-capture" />;
}
