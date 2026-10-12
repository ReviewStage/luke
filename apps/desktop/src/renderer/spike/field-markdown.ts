// field-markdown.ts -- SPIKE: one field's Markdown to a ProseMirror document and back, over the mdast the renderer already bundles.

import type { BlockContent, Content, ListItem, PhrasingContent, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { type Options as ToMarkdownOptions, toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import type { Node as PmNode } from "prosemirror-model";

/**
 * SPIKE, not production code. A field of the plan is its own Markdown (a
 * text field), its own list of items, or a rule's parts; this module is the
 * text field's half. Parsing and printing ride on `mdast-util-from-markdown`
 * and `mdast-util-to-markdown`, which `react-markdown` and `remark-gfm`
 * already put in the renderer bundle, so the editor adds no Markdown parser
 * of its own (TipTap's `@tiptap/markdown` brings `marked`, ProseMirror's
 * `prosemirror-markdown` brings `markdown-it`).
 *
 * Node and mark names are TipTap's (`bulletList`, `bold`, ...), so the one
 * bridge serves the minimal ProseMirror schema and TipTap's StarterKit alike.
 *
 * Note that a block the developer did not touch is printed as its original
 * source slice, because a printer normalises (`*` bullets become `-`, a
 * soft-wrapped paragraph is re-joined): re-printing the whole field would
 * hand the service's three-way merge a "change" on every line, and that
 * merge is what keeps the developer's edit and Luke's live writes apart.
 * ProseMirror keeps an untouched node's identity across transactions, so
 * "untouched" is an `===` test against the nodes the document opened with.
 */

/** A ProseMirror document as JSON, the shape both `Node.fromJSON` and TipTap's `setContent` take. */
export interface PmJson {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly PmJson[];
  readonly marks?: readonly { type: string; attrs?: Record<string, unknown> }[];
  readonly text?: string;
}

/** A field's document as opened: the JSON to build it from, and each top-level block's source. */
export interface OpenedField {
  readonly doc: PmJson;
  readonly sources: readonly string[];
}

/** The source the document opened with, by the top-level node it opened as. */
export type FieldSources = ReadonlyMap<PmNode, string>;

const MDAST_OPTIONS = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };
const PRINT_OPTIONS: ToMarkdownOptions = {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fences: true,
  listItemIndent: "one",
  extensions: [gfmToMarkdown()],
};

type Mark = { type: string; attrs?: Record<string, unknown> };

function textNode(text: string, marks: readonly Mark[]): PmJson {
  return marks.length === 0 ? { type: "text", text } : { type: "text", text, marks };
}

/** Inline mdast as ProseMirror inline nodes, each mark carried down to its text. */
function inlineOf(
  nodes: readonly PhrasingContent[],
  marks: readonly Mark[],
  src: string,
): PmJson[] {
  return nodes.flatMap((node): PmJson[] => {
    switch (node.type) {
      case "text":
        return node.value === "" ? [] : [textNode(node.value, marks)];
      case "strong":
        return inlineOf(node.children, [...marks, { type: "bold" }], src);
      case "emphasis":
        return inlineOf(node.children, [...marks, { type: "italic" }], src);
      case "delete":
        return inlineOf(node.children, [...marks, { type: "strike" }], src);
      case "inlineCode":
        return [textNode(node.value, [...marks, { type: "code" }])];
      case "link":
        return inlineOf(
          node.children,
          [...marks, { type: "link", attrs: { href: node.url } }],
          src,
        );
      case "break":
        return [{ type: "hardBreak" }];
      default: {
        // An image, inline HTML, or a footnote reference: kept as the words it was written as.
        const start = node.position?.start.offset ?? 0;
        const end = node.position?.end.offset ?? 0;
        const raw = src.slice(start, end);
        return raw === "" ? [] : [textNode(raw, marks)];
      }
    }
  });
}

function paragraphOf(children: readonly PhrasingContent[], src: string): PmJson {
  const content = inlineOf(children, [], src);
  return content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content };
}

function listItemOf(item: ListItem, src: string): PmJson {
  const content = item.children.map((child) => blockOf(child, src));
  return { type: "listItem", content: content.length === 0 ? [{ type: "paragraph" }] : content };
}

/** One mdast block as a ProseMirror block; anything the schema does not edit stays its source, drawn but untouchable. */
function blockOf(node: RootContent | BlockContent | Content, src: string): PmJson {
  switch (node.type) {
    case "paragraph":
      return paragraphOf(node.children, src);
    // The formatter escapes a heading in a field, so one here is a paragraph's words.
    case "heading":
      return paragraphOf(node.children, src);
    case "list":
      return node.ordered
        ? {
            type: "orderedList",
            attrs: { start: node.start ?? 1 },
            content: node.children.map((item) => listItemOf(item, src)),
          }
        : { type: "bulletList", content: node.children.map((item) => listItemOf(item, src)) };
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null },
        ...(node.value === "" ? {} : { content: [{ type: "text", text: node.value }] }),
      };
    case "blockquote":
      return { type: "blockquote", content: node.children.map((child) => blockOf(child, src)) };
    default: {
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? 0;
      return { type: "rawBlock", attrs: { source: src.slice(start, end) } };
    }
  }
}

/** A field's Markdown opened as a document, an empty paragraph for an unanswered field. */
export function fieldOpened(markdown: string | null): OpenedField {
  const src = markdown ?? "";
  const root = fromMarkdown(src, MDAST_OPTIONS);
  // Note that a link's definition is kept as a block of its own, because a `[link][ref]` elsewhere still reads it.
  const blocks = root.children;
  if (blocks.length === 0)
    return { doc: { type: "doc", content: [{ type: "paragraph" }] }, sources: [""] };
  return {
    doc: { type: "doc", content: blocks.map((node) => blockOf(node, src)) },
    sources: blocks.map((node) =>
      src.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0),
    ),
  };
}

/** The mdast mark a ProseMirror mark prints as, wrapping its children. */
function wrapped(mark: PmNode["marks"][number], children: PhrasingContent[]): PhrasingContent {
  switch (mark.type.name) {
    case "bold":
      return { type: "strong", children };
    case "italic":
      return { type: "emphasis", children };
    case "strike":
      return { type: "delete", children };
    case "link":
      return { type: "link", url: String(mark.attrs.href ?? ""), children };
    default:
      return { type: "emphasis", children };
  }
}

/** Mark names in the order they nest, outermost first, so runs that share an outer mark print as one. */
const MARK_ORDER = ["link", "bold", "italic", "strike"] as const;

/** ProseMirror inline content as mdast, adjacent runs under the same outer mark merged. */
function phrasingOf(parent: PmNode): PhrasingContent[] {
  const runs: { marks: PmNode["marks"]; leaf: PhrasingContent }[] = [];
  parent.forEach((child) => {
    if (child.type.name === "hardBreak") runs.push({ marks: [], leaf: { type: "break" } });
    else if (child.isText) {
      const code = child.marks.some((mark) => mark.type.name === "code");
      const leaf: PhrasingContent = code
        ? { type: "inlineCode", value: child.text ?? "" }
        : { type: "text", value: child.text ?? "" };
      const marks = [...child.marks]
        .filter((mark) => mark.type.name !== "code")
        .sort(
          (left, right) =>
            MARK_ORDER.indexOf(left.type.name as (typeof MARK_ORDER)[number]) -
            MARK_ORDER.indexOf(right.type.name as (typeof MARK_ORDER)[number]),
        );
      // Whitespace at a marked run's edge prints outside the mark, since `**often **` is not emphasis in Markdown.
      const text = child.text ?? "";
      const lead = code || marks.length === 0 ? "" : (/^\s+/u.exec(text)?.[0] ?? "");
      const trail =
        code || marks.length === 0 ? "" : (/\s+$/u.exec(text.slice(lead.length))?.[0] ?? "");
      const core = text.slice(lead.length, text.length - trail.length);
      if (lead !== "") runs.push({ marks: [], leaf: { type: "text", value: lead } });
      if (core !== "" || lead === "")
        runs.push({ marks, leaf: code ? leaf : { type: "text", value: core } });
      if (trail !== "") runs.push({ marks: [], leaf: { type: "text", value: trail } });
    }
  });
  return nest(runs, 0);
}

function nest(
  runs: readonly { marks: PmNode["marks"]; leaf: PhrasingContent }[],
  depth: number,
): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let index = 0;
  while (index < runs.length) {
    const run = runs[index];
    if (run === undefined) break;
    const mark = run.marks[depth];
    if (mark === undefined) {
      out.push(run.leaf);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < runs.length && runs[end]?.marks[depth]?.eq(mark)) end += 1;
    out.push(wrapped(mark, nest(runs.slice(index, end), depth + 1)));
    index = end;
  }
  return out;
}

/** One ProseMirror block as mdast. */
function mdastOf(node: PmNode): RootContent {
  switch (node.type.name) {
    case "bulletList":
    case "orderedList": {
      const children: ListItem[] = [];
      node.forEach((item) => {
        const blocks: BlockContent[] = [];
        item.forEach((child) => {
          blocks.push(mdastOf(child) as BlockContent);
        });
        children.push({ type: "listItem", spread: false, children: blocks });
      });
      const ordered = node.type.name === "orderedList";
      return {
        type: "list",
        ordered,
        start: ordered ? Number(node.attrs.start ?? 1) : null,
        spread: false,
        children,
      };
    }
    case "codeBlock":
      return {
        type: "code",
        lang: (node.attrs.language as string | null) ?? null,
        value: node.textContent,
      };
    case "blockquote": {
      const children: BlockContent[] = [];
      node.forEach((child) => {
        children.push(mdastOf(child) as BlockContent);
      });
      return { type: "blockquote", children };
    }
    case "rawBlock":
      return { type: "html", value: String(node.attrs.source ?? "") };
    default:
      return { type: "paragraph", children: phrasingOf(node) };
  }
}

/** Inline content printed as one line of Markdown: a list item, a rule's statement, or a clause. */
export function inlineMarkdown(parent: PmNode): string {
  const root: Root = {
    type: "root",
    children: [{ type: "paragraph", children: phrasingOf(parent) }],
  };
  return toMarkdown(root, PRINT_OPTIONS).trimEnd();
}

/** One line of Markdown as inline content, for a list item, a statement, or a clause. */
export function inlineOpened(markdown: string): PmJson[] {
  const root = fromMarkdown(markdown, MDAST_OPTIONS);
  const first = root.children[0];
  return first?.type === "paragraph"
    ? inlineOf(first.children, [], markdown)
    : markdown === ""
      ? []
      : [textNode(markdown, [])];
}

/**
 * The field's Markdown as the document now holds it: each block it opened
 * with and still holds printed as its source, every other block printed
 * fresh; null where nothing but whitespace is left, which is unanswered.
 */
export function fieldMarkdown(doc: PmNode, sources: FieldSources): string | null {
  const blocks: string[] = [];
  doc.forEach((child) => {
    const source = sources.get(child);
    if (source !== undefined) blocks.push(source);
    else if (!(child.type.name === "paragraph" && child.content.size === 0)) {
      blocks.push(
        toMarkdown({ type: "root", children: [mdastOf(child)] }, PRINT_OPTIONS).trimEnd(),
      );
    }
  });
  const markdown = blocks.join("\n\n").trim();
  return markdown === "" ? null : markdown;
}
