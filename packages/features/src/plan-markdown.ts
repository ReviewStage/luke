import { TASK_BOUNDS, type Task } from "./task-wire.js";

/**
 * plan-markdown.ts -- a plan as the readable Markdown Copy puts on the clipboard and a coding agent is handed.
 *
 * A plan is one Markdown text with no title line, since its name is its own,
 * so Copy is its name as a title over its text, which holds its assumptions
 * and every other section itself (`docs/TASKS.md`, "Copy").
 */

/** A run of whitespace, line breaks among it, which a title spells as one space. */
const WHITESPACE_RUN = /\s+/gu;

/** What the title line adds to the text: its marker, the longest name, and the blank line under it. */
const TITLE_OVERHEAD = "# ".length + TASK_BOUNDS.MAX_NAME_CHARS + "\n\n".length;

/**
 * The most characters the Markdown of any plan the store admits can spell:
 * the title, then the longest text, then its closing break. The copy act
 * admits this much, so no saved plan is too long to copy.
 */
export const PLAN_MARKDOWN_MAX_CHARS = TITLE_OVERHEAD + TASK_BOUNDS.MAX_BODY_CHARS + 1;

/** The plan as Markdown: its name as a title over its text. */
export function planMarkdown(task: Pick<Task, "name" | "document">): string {
  const body = task.document.body.trimEnd();
  const title = `# ${task.name.replace(WHITESPACE_RUN, " ").trim()}`;
  return body.length === 0 ? `${title}\n` : `${title}\n\n${body}\n`;
}
