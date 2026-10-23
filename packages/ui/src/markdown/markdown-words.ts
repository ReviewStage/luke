/**
 * markdown-words.ts -- Markdown read as its tree or as plain words, for a place that reads a message rather than drawing it: a row previewing it on one line, or a page reading a release's headline.
 */

import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** The nodes whose children run on inside one line of text, joined as they stand; every other parent's are blocks, joined by a space. */
const PHRASING_PARENTS: ReadonlySet<Nodes["type"]> = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);

/** The HTML elements that stand as blocks of their own, whose words a preview keeps apart from their neighbours'. */
const HTML_BLOCKS: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/** A parsed HTML node's words: a text's own, an element's children's run on, a block's kept apart by spaces, a comment's none. */
function domWords(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  const inner = [...node.childNodes].map(domWords).join("");
  return node.nodeType === Node.ELEMENT_NODE && HTML_BLOCKS.has(node.nodeName.toLowerCase())
    ? ` ${inner} `
    : inner;
}

/**
 * Raw HTML's words as the message draws them: the text between its tags,
 * its entities decoded, each block's apart from the next, read by the
 * window's own HTML parser, which builds an inert document that runs and
 * loads nothing. Note that the rail is only ever drawn in a window, so the
 * parser is always there.
 */
function htmlWords(html: string): string {
  return domWords(new DOMParser().parseFromString(html, "text/html").body);
}

/** A node's words as drawn: text and code by their own words, a picture by its alt, raw HTML by the text between its tags. */
function nodeWords(node: Nodes): string {
  switch (node.type) {
    case "html":
      // Note that the message draws the text inside ordinary HTML, so the preview keeps it; React escapes it as plain text.
      return htmlWords(node.value);
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "break":
      return " ";
    default:
      break;
  }
  if ("value" in node) return node.value;
  if (!("children" in node)) return "";
  const words: string[] = node.children.map((child: Nodes) => nodeWords(child));
  return words.join(PHRASING_PARENTS.has(node.type) ? "" : " ");
}

/** Markdown read as its tree, in GitHub's dialect, each node with its place in the words: the tree every drawing of Markdown is drawn from. */
export function markdownTree(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/**
 * A block of Markdown as plain words, read by the parser every drawing of
 * Markdown reads it with, so what it drops is exactly the marks a drawing
 * never shows, and every word it does show (a code span's, an identifier's
 * underscores, a lone star) stays as written: a chip as its label, a picture
 * by its words, and the words inside ordinary HTML.
 */
export function markdownWords(text: string): string {
  return nodeWords(markdownTree(text));
}
