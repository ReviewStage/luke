/**
 * A chat message's words as the rail's row previews them: one plain line,
 * its Markdown read by the same parser the message is drawn with, so what
 * the preview drops is exactly the marks the message never shows, and every
 * word it does show (a code span's, an identifier's underscores, a lone
 * star) stays as written.
 */

import { CHAT_BLOCK, type ChatMessage } from "@luke/features/chat-wire";
import type { Nodes } from "mdast";
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

/** Raw HTML's tags and comments, which the message draws as no words of its own. */
const HTML_MARKUP = /<!--[\s\S]*?-->|<[^>]*>/gu;

/** A node's words as drawn: text and code by their own words, a picture by its alt, raw HTML by the text between its tags. */
function nodeWords(node: Nodes): string {
  switch (node.type) {
    case "html":
      // Note that the message draws the text inside ordinary HTML, so the preview keeps it; React escapes it as plain text.
      return node.value.replace(HTML_MARKUP, " ");
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

/** A block of Markdown as plain words. */
function markdownWords(text: string): string {
  return nodeWords(
    fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }),
  );
}

/** A message's words as a row previews them, one line: its Markdown read as plain words, a chip as its label; a picture alone by its words. */
export function previewWords(message: ChatMessage): string {
  const words = message.blocks.map((block) =>
    block.type === CHAT_BLOCK.MARKDOWN && "text" in block
      ? markdownWords(block.text)
      : block.type === CHAT_BLOCK.IMAGE && "alt" in block
        ? block.alt
        : block.type === CHAT_BLOCK.LINK && "label" in block
          ? block.label
          : "",
  );
  return words.join(" ").replace(/\s+/gu, " ").trim();
}
