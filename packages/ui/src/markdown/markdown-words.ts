/**
 * markdown-words.ts -- Markdown read as its tree, for a place that reads a message rather than drawing it, such as a page reading a release's headline.
 */

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** Markdown read as its tree, in GitHub's dialect, each node with its place in the words: the tree every drawing of Markdown is drawn from. */
export function markdownTree(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

