/**
 * markdown-class.ts -- the classes a note's Markdown is drawn with (`markdown.tsx`), apart from the renderer, so the plan's editor wears them without reaching the parser.
 */

import { PROSE_CLASS } from "../components/prose/prose.js";

/** The classes a note is drawn with: its root, and a heading drawn as a paragraph. */
export const MARKDOWN_CLASS = {
  ROOT: "luke-markdown",
  HEADING: "luke-markdown-heading",
} as const;

/** A note's root classes, with a place's own after them: an editor standing in drawn words' place wears the same, so opening it moves no word. */
export function markdownClass(className?: string): string {
  const root = `${MARKDOWN_CLASS.ROOT} ${PROSE_CLASS}`;
  return className === undefined ? root : `${root} ${className}`;
}
