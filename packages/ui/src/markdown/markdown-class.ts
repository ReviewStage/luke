/**
 * markdown-class.ts -- the classes a note's Markdown is drawn with (`markdown.tsx`), apart from the renderer, so the description's editor wears them without reaching the parser.
 */

import { PROSE_CLASS } from "../components/prose/prose.js";

/**
 * The classes a note is drawn with: its root, a heading drawn as a paragraph,
 * a task item, by the name GitHub's dialect gives it, and the box its
 * checkbox stands in, in the bullet's gutter (`prose.css`).
 */
export const MARKDOWN_CLASS = {
  ROOT: "ui-markdown",
  HEADING: "ui-markdown-heading",
  TASK_ITEM: "task-list-item",
  TASK_BOX: "ui-markdown-task",
} as const;

/** A note's root classes, with a place's own after them: an editor standing in drawn words' place wears the same, so opening it moves no word. */
export function markdownClass(className?: string): string {
  const root = `${MARKDOWN_CLASS.ROOT} ${PROSE_CLASS}`;
  return className === undefined ? root : `${root} ${className}`;
}
