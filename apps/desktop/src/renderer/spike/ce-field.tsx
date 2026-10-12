// ce-field.tsx -- SPIKE: a plan field edited in place on plain contenteditable with a small serializer of our own, for comparison.

import { useLayoutEffect, useRef } from "react";
import { MarkdownMessage } from "../markdown-message";
import { type FieldValue, PM_FIELD_KIND } from "./field-value";

/**
 * SPIKE, not production code. The drawn words themselves become editable:
 * React draws the field's Markdown once, then lets go of the subtree, and
 * the browser edits the DOM as it likes. A small walker reads the DOM back
 * as Markdown (paragraphs, lists, code, the inline marks). There is no
 * schema, so nothing stops Enter writing a `<div>`, a paste carrying a
 * heading, or a rule's label being deleted; there are no Markdown shortcuts
 * but the browser's own ⌘B/⌘I, which write `<b>`/`<i>`; and undo is the
 * browser's, which forgets everything the moment anything rewrites the DOM.
 * A rule is shown here as its statement alone, since its examples need
 * structure contenteditable cannot hold.
 */

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.getAttribute("contenteditable") === "false") return "";
  const inner = [...node.childNodes].map(inline).join("");
  switch (node.tagName) {
    case "STRONG":
    case "B":
      return inner === "" ? "" : `**${inner}**`;
    case "EM":
    case "I":
      return inner === "" ? "" : `*${inner}*`;
    case "DEL":
    case "S":
      return inner === "" ? "" : `~~${inner}~~`;
    case "CODE":
      return inner === "" ? "" : `\`${inner}\``;
    case "BR":
      return "\n";
    case "SPAN":
      return node.classList.contains("markdown-link") ? `[${inner}](${node.title})` : inner;
    default:
      return inner;
  }
}

/** One block of the edited DOM as Markdown lines. */
function block(node: Node, depth: number): string[] {
  if (!(node instanceof HTMLElement)) {
    const words = (node.textContent ?? "").trim();
    return words === "" ? [] : [words];
  }
  switch (node.tagName) {
    case "UL":
    case "OL": {
      const ordered = node.tagName === "OL";
      return [...node.children].flatMap((item, index) => {
        // Inline children run together into the item's first line; a nested block is lines of its own.
        const lines: string[] = [""];
        for (const child of item.childNodes) {
          if (child instanceof HTMLElement && /^(UL|OL|P|DIV)$/u.test(child.tagName))
            lines.push(...block(child, depth + 1));
          else lines[0] += inline(child);
        }
        const [first = "", ...rest] = lines;
        const marker = ordered ? `${index + 1}. ` : "- ";
        return [`${"  ".repeat(depth)}${marker}${first.trim()}`, ...rest];
      });
    }
    case "PRE":
      return ["```", node.textContent ?? "", "```"];
    default: {
      const words = inline(node).trim();
      return words === "" ? [] : [words];
    }
  }
}

function valueOfDom(kind: FieldValue["kind"], root: HTMLElement): FieldValue {
  const container = root.querySelector(".markdown") ?? root;
  const blocks = [...container.childNodes]
    .map((child) => block(child, 0).join("\n"))
    .filter((b) => b !== "");
  if (kind === PM_FIELD_KIND.ITEMS) {
    const items = blocks
      .join("\n")
      .split("\n")
      .map((line) => line.replace(/^\s*[-*+]\s+/u, "").trim());
    return { kind, items: items.filter((item) => item !== "") };
  }
  if (kind === PM_FIELD_KIND.RULE)
    return { kind, rule: { statement: blocks.join(" "), examples: [] } };
  const markdown = blocks.join("\n\n").trim();
  return { kind, markdown: markdown === "" ? null : markdown };
}

function markdownOf(value: FieldValue): string {
  if (value.kind === PM_FIELD_KIND.TEXT) return value.markdown ?? "";
  if (value.kind === PM_FIELD_KIND.ITEMS) return value.items.map((item) => `- ${item}`).join("\n");
  return value.rule.statement;
}

/** One field as editable drawn words, with the props `pm-field.tsx`'s takes. */
export function ContentEditableFieldEditor({
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
  const host = useRef<HTMLDivElement>(null);
  // Drawn once and never again: React re-rendering a contenteditable subtree undoes the typing.
  const words = useRef(markdownOf(value));

  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    element.focus();
    // Note that the point is checked against the field, because unlike ProseMirror's `posAtCoords` the browser's answer is not clamped to it.
    const caret = at === undefined ? null : document.caretPositionFromPoint(at.x, at.y);
    const range = document.createRange();
    if (caret !== null && element.contains(caret.offsetNode))
      range.setStart(caret.offsetNode, caret.offset);
    else {
      range.selectNodeContents(element);
      range.collapse(false);
    }
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [at]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: the spike compares a contenteditable field with the editors; a textarea is what it replaces.
    <div
      ref={host}
      className="ph-no-capture spike-editor-host spike-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      tabIndex={0}
      onInput={(event) => onDraft(valueOfDom(value.kind, event.currentTarget))}
      onPaste={(event) => {
        // Note that a paste is taken as plain text, because a schema-less DOM would keep a pasted page's headings and styles.
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || (event.key === "Enter" && event.metaKey)) {
          event.preventDefault();
          onFinish();
        }
      }}
      onBlur={onFinish}
    >
      <MarkdownMessage words={words.current} className={className} />
    </div>
  );
}
