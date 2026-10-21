/** markdown-document.ts -- the site's trusted documents, read by the panel's Markdown parser family. */

import type { Element, RootContent as HtmlContent, Nodes as HtmlNode } from "hast";
import { toHtml } from "hast-util-to-html";
import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";

const HTML_OPTIONS = {
  allowDangerousHtml: true,
  characterReferences: { useNamedReferences: true },
};

/** Rewrite children first, so wrapping an image does not visit the new wrapper again. */
function rewriteElements(node: HtmlNode, rewrite: (element: Element) => void): void {
  if ("children" in node) for (const child of node.children) rewriteElements(child, rewrite);
  if (node.type === "element") rewrite(node);
}

/** A complete GFM document, including reference definitions used by later sections. */
export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/**
 * HTML for repository-authored documents only, not user input: raw HTML is
 * preserved as it was in marked. Link/image rewriting happens after reference
 * resolution, so inline and reference-style links have the same behavior.
 */
export function markdownHtml(tree: Root, rewrite?: (element: Element) => void): string {
  const html = toHast(tree, { allowDangerousHtml: true });
  if (rewrite) rewriteElements(html, rewrite);
  return toHtml(html, HTML_OPTIONS);
}

/** Plain words for share cards: emphasis and links keep their text, pictures contribute none. */
export function markdownText(node: Nodes): string {
  if (node.type === "image" || node.type === "imageReference" || node.type === "definition")
    return "";
  if (node.type === "break") return " ";
  if ("value" in node) return node.value;
  if (!("children" in node)) return "";
  const blocks =
    node.type === "root" ||
    node.type === "blockquote" ||
    node.type === "list" ||
    node.type === "listItem";
  return node.children.map(markdownText).join(blocks ? " " : "");
}

/**
 * A policy's top-level title and second-level sections. Resolve the whole
 * document before splitting, so references inside any list or quote remain
 * available across sections, and heading children stay inline.
 */
export function markdownSections(markdown: string): {
  title: string | null;
  sections: { title: string | null; html: string }[];
} {
  const tree = toHast(parseMarkdown(markdown), { allowDangerousHtml: true });
  if (tree.type !== "root") throw new Error("A Markdown document must produce an HTML root");
  let title: string | null = null;
  const sections: { title: string | null; children: HtmlContent[] }[] = [
    { title: null, children: [] },
  ];
  for (const node of tree.children) {
    if (node.type === "element" && node.tagName === "h1")
      title = toHtml(node.children, HTML_OPTIONS);
    else if (node.type === "element" && node.tagName === "h2")
      sections.push({ title: toHtml(node.children, HTML_OPTIONS), children: [] });
    else sections.at(-1)?.children.push(node);
  }
  return {
    title,
    sections: sections
      .filter(
        (section) =>
          section.title !== null ||
          section.children.some((node) => node.type !== "text" || node.value.trim().length > 0),
      )
      .map((section) => ({ title: section.title, html: toHtml(section.children, HTML_OPTIONS) })),
  };
}
