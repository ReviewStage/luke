import {
  MARKDOWN_BLOCK_KIND,
  MARKDOWN_INLINE_KIND,
  MARKDOWN_TABLE_ALIGNMENT,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownListItem,
  type MarkdownTableAlignment,
  parseMarkdown,
} from "@sidecar/markdown";
import { createElement, type ReactNode, useMemo } from "react";

const TABLE_ALIGN_ATTRIBUTE = {
  [MARKDOWN_TABLE_ALIGNMENT.LEADING]: "leading",
  [MARKDOWN_TABLE_ALIGNMENT.CENTER]: "center",
  [MARKDOWN_TABLE_ALIGNMENT.TRAILING]: "trailing",
} as const;

/**
 * A message's words drawn as the Markdown they were written in, the way the
 * iOS app's bubbles draw them: inline emphasis, code, strikethrough, and web
 * links inside the paragraph, and the blocks a paragraph cannot hold —
 * headings, lists, quotes, fenced code, tables, rules — composed around it.
 * Every size is in `em`, so the same component reads at the caption's ten
 * pixels and the thread's twelve and a half.
 *
 * A link is drawn as one and names its destination on hover, but it is not a
 * control: the renderer refuses every navigation and has no door for opening
 * an arbitrary address, and a message's words must not become an act by
 * being pressed. Only HTTP and HTTPS destinations reach here at all; the
 * parser has already reduced every other scheme to its words.
 *
 * `trailing` rides inside the last paragraph, where a chat app puts its
 * timestamp, or on a line of its own when the message ends in something else.
 */
export function MarkdownMessage({
  words,
  className,
  trailing,
}: {
  words: string;
  className?: string;
  trailing?: ReactNode;
}): React.JSX.Element {
  const blocks = useMemo(() => parseMarkdown(words), [words]);
  const last = blocks[blocks.length - 1];
  const trailingInLastParagraph =
    trailing !== undefined && last !== undefined && last.kind === MARKDOWN_BLOCK_KIND.PARAGRAPH;
  const children = blocks.map((block, index) =>
    trailingInLastParagraph && index === blocks.length - 1
      ? renderBlock(block, trailing)
      : renderBlock(block),
  );
  if (trailing !== undefined && !trailingInLastParagraph) {
    children.push(createElement("p", { className: "markdown-trailing" }, trailing));
  }
  return createElement(
    "div",
    { className: className === undefined ? "markdown" : `markdown ${className}` },
    ...children,
  );
}

function renderBlock(block: MarkdownBlock, trailing?: ReactNode): ReactNode {
  switch (block.kind) {
    case MARKDOWN_BLOCK_KIND.PARAGRAPH:
      return createElement("p", null, ...renderInlines(block.inlines), trailing);
    case MARKDOWN_BLOCK_KIND.HEADING:
      // Styled as a heading, never announced as one: a reader walking the
      // document's headings should meet the panel's, not a reply's.
      return createElement(
        "p",
        { className: "markdown-heading", "data-level": block.level },
        ...renderInlines(block.inlines),
      );
    case MARKDOWN_BLOCK_KIND.CODE:
      return createElement(
        "pre",
        block.language === undefined ? null : { "data-language": block.language },
        createElement("code", null, block.code),
      );
    case MARKDOWN_BLOCK_KIND.QUOTE:
      return createElement("blockquote", null, ...block.blocks.map((inner) => renderBlock(inner)));
    case MARKDOWN_BLOCK_KIND.LIST: {
      const start = block.items[0]?.ordinal;
      return createElement(
        block.ordered ? "ol" : "ul",
        block.ordered && start !== undefined && start !== 1 ? { start } : null,
        ...block.items.map(renderListItem),
      );
    }
    case MARKDOWN_BLOCK_KIND.TABLE:
      return renderTable(block.header, block.alignments, block.rows);
    case MARKDOWN_BLOCK_KIND.RULE:
      return createElement("hr");
  }
}

function renderListItem(item: MarkdownListItem): ReactNode {
  const blocks = item.blocks.map((block) => renderBlock(block));
  if (item.checked === undefined) return createElement("li", null, ...blocks);
  return createElement(
    "li",
    { className: "markdown-task", "data-checked": item.checked ? "true" : "false" },
    createElement("span", { className: "visually-hidden" }, item.checked ? "Done: " : "To do: "),
    ...blocks,
  );
}

function renderTable(
  header: readonly MarkdownInline[][],
  alignments: readonly MarkdownTableAlignment[],
  rows: readonly MarkdownInline[][][],
): ReactNode {
  const alignAttribute = (column: number) => {
    const alignment = alignments[column];
    return alignment === undefined ? null : { "data-align": TABLE_ALIGN_ATTRIBUTE[alignment] };
  };
  return createElement(
    "div",
    { className: "markdown-table-scroll" },
    createElement(
      "table",
      null,
      createElement(
        "thead",
        null,
        createElement(
          "tr",
          null,
          ...header.map((cell, column) =>
            createElement("th", alignAttribute(column), ...renderInlines(cell)),
          ),
        ),
      ),
      createElement(
        "tbody",
        null,
        ...rows.map((row) =>
          createElement(
            "tr",
            null,
            ...row.map((cell, column) =>
              createElement("td", alignAttribute(column), ...renderInlines(cell)),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderInlines(inlines: readonly MarkdownInline[]): ReactNode[] {
  return inlines.map(renderInline);
}

function renderInline(inline: MarkdownInline): ReactNode {
  switch (inline.kind) {
    case MARKDOWN_INLINE_KIND.TEXT:
      return inline.text;
    case MARKDOWN_INLINE_KIND.BREAK:
      return createElement("br");
    case MARKDOWN_INLINE_KIND.CODE:
      return createElement("code", null, inline.code);
    case MARKDOWN_INLINE_KIND.STRONG:
      return createElement("strong", null, ...renderInlines(inline.inlines));
    case MARKDOWN_INLINE_KIND.EMPHASIS:
      return createElement("em", null, ...renderInlines(inline.inlines));
    case MARKDOWN_INLINE_KIND.STRIKETHROUGH:
      return createElement("s", null, ...renderInlines(inline.inlines));
    case MARKDOWN_INLINE_KIND.LINK:
      return createElement(
        "span",
        { className: "markdown-link", title: inline.href },
        ...renderInlines(inline.inlines),
      );
  }
}
