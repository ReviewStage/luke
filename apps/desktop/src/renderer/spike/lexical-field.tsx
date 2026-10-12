// lexical-field.tsx -- SPIKE: a plan's text field or list edited in place on Lexical, for comparison.

import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  CODE,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  type Transformer,
  UNORDERED_LIST,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { QuoteNode } from "@lexical/rich-text";
import { COMMAND_PRIORITY_HIGH, KEY_ESCAPE_COMMAND } from "lexical";
import { useLayoutEffect, useRef } from "react";
import { type FieldValue, PM_FIELD_KIND } from "./field-value";

/**
 * SPIKE, not production code. Lexical's own model and its own Markdown
 * transformers, every heading transformer left out. Only a text field and a
 * list are prototyped: a rule would need six custom `ElementNode` classes
 * and their key handling, which Lexical has no schema language for, and the
 * text-field prototype was enough to measure the library and its feel.
 * Note that `$convertToMarkdownString` re-prints the whole field, so an
 * edit to one line hands the service's merge every line it normalised.
 */

/** The Markdown Lexical reads and writes for a field: every transformer but a heading's. */
const FIELD_TRANSFORMERS: Transformer[] = [
  UNORDERED_LIST,
  ORDERED_LIST,
  QUOTE,
  CODE,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  LINK,
];

const THEME = {
  text: {
    bold: "spike-bold",
    italic: "spike-italic",
    code: "spike-code",
    strikethrough: "spike-strike",
  },
  link: "markdown-link",
};

/** The field's stored value as the Markdown Lexical opens. */
function markdownOf(value: FieldValue): string {
  if (value.kind === PM_FIELD_KIND.TEXT) return value.markdown ?? "";
  if (value.kind === PM_FIELD_KIND.ITEMS) return value.items.map((item) => `- ${item}`).join("\n");
  return value.rule.statement;
}

/** Lexical's Markdown read back as the field's value. */
function valueOfMarkdown(kind: FieldValue["kind"], markdown: string): FieldValue {
  if (kind === PM_FIELD_KIND.ITEMS) {
    const items = markdown
      .split("\n")
      .map((line) => line.replace(/^\s*[-*+]\s+/u, "").trim())
      .filter((line) => line !== "");
    return { kind, items };
  }
  if (kind === PM_FIELD_KIND.RULE) return { kind, rule: { statement: markdown, examples: [] } };
  const trimmed = markdown.trim();
  return { kind: PM_FIELD_KIND.TEXT, markdown: trimmed === "" ? null : trimmed };
}

/** Esc finishes, and the caret lands where the click did. */
function FieldBehaviour({
  at,
  onFinish,
}: {
  at: { readonly x: number; readonly y: number } | undefined;
  onFinish: () => void;
}): null {
  const [editor] = useLexicalComposerContext();
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useLayoutEffect(() => {
    const unregister = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        finish.current();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const root = editor.getRootElement();
    root?.focus();
    const caret = at === undefined ? null : document.caretPositionFromPoint(at.x, at.y);
    if (caret !== null) {
      const range = document.createRange();
      range.setStart(caret.offsetNode, caret.offset);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
    return unregister;
  }, [editor, at]);
  return null;
}

/** One field in Lexical's editor, with the props `pm-field.tsx`'s takes. */
export function LexicalFieldEditor({
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
  const markdown = markdownOf(value);
  const config = {
    namespace: "spike-field",
    nodes: [ListNode, ListItemNode, LinkNode, CodeNode, QuoteNode],
    theme: THEME,
    onError: (error: Error) => {
      throw error;
    },
    editorState: () => $convertFromMarkdownString(markdown, FIELD_TRANSFORMERS),
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the host only hears focus leaving and ⌘↩ from the editor inside it.
    <div
      className="ph-no-capture spike-editor-host"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFinish();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.metaKey) onFinish();
      }}
    >
      <LexicalComposer initialConfig={config}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable className={`${className} spike-editor`} aria-label={label} />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={FIELD_TRANSFORMERS} />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state) =>
            state.read(() =>
              onDraft(valueOfMarkdown(value.kind, $convertToMarkdownString(FIELD_TRANSFORMERS))),
            )
          }
        />
        <FieldBehaviour at={at} onFinish={onFinish} />
      </LexicalComposer>
    </div>
  );
}
