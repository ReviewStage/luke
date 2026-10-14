import { fenceClosed, rolloutSection } from "./plan-template.js";
import { PLAN_BOUNDS, type Plan, ROLLOUT_BOUNDS } from "./plan-wire.js";

/**
 * plan-markdown.ts -- a plan as the readable Markdown Copy puts on the clipboard and a coding agent is handed.
 *
 * A plan is one Markdown text with no title line, since its name is its own,
 * so Copy is its name as a title over its text, which holds its assumptions
 * and every other section itself (`docs/PLANNING.md`, "Copy"), then its
 * rollout's section, drawn from the rollout beside the text, which no saved
 * text holds.
 */

/** A run of whitespace, line breaks among it, which a title spells as one space. */
const WHITESPACE_RUN = /\s+/gu;

/** What the title line adds to the text: its marker, the longest name, and the blank line under it. */
const TITLE_OVERHEAD = "# ".length + PLAN_BOUNDS.MAX_NAME_CHARS + "\n\n".length;

/**
 * How many characters one character of a rollout item's scope or acceptance
 * can grow to drawn: a one-letter line escaped and indented under its marker,
 * `#` and its line break becoming four spaces, a backslash, `#`, and the break.
 */
const ROLLOUT_TEXT_GROWTH = 4;

/** The most characters one rollout item can spell drawn: its marker and title line, then its scope and acceptance with the words around them. */
const ROLLOUT_ITEM_MAX_CHARS =
  ROLLOUT_BOUNDS.MAX_TITLE_CHARS + 64 + 2 * ROLLOUT_TEXT_GROWTH * ROLLOUT_BOUNDS.MAX_TEXT_CHARS;

/** The most characters the rollout's section can spell, with the blank line before it. */
const ROLLOUT_MAX_CHARS = 32 + ROLLOUT_BOUNDS.MAX_PULL_REQUESTS * ROLLOUT_ITEM_MAX_CHARS;

/** The most characters closing a fence the text leaves open can add: a line break, and a fence's run, which is no longer than the text. */
const FENCE_CLOSE_MAX_CHARS = 1 + PLAN_BOUNDS.MAX_BODY_CHARS;

/**
 * The most characters the Markdown of any plan the store admits can spell:
 * the title, then the longest text and the line closing a fence it leaves
 * open, then the longest rollout, then its closing break. The copy act
 * admits this much, so no saved plan is too long to copy.
 */
export const PLAN_MARKDOWN_MAX_CHARS =
  TITLE_OVERHEAD + PLAN_BOUNDS.MAX_BODY_CHARS + FENCE_CLOSE_MAX_CHARS + ROLLOUT_MAX_CHARS + 1;

/**
 * The plan as Markdown: its name as a title over its text, then its
 * rollout's section, which stands whether or not the rollout holds anything.
 * Note that a fence the text leaves open is closed before the rollout,
 * because otherwise the rollout would be copied as the fence's code.
 */
export function planMarkdown(plan: Pick<Plan, "name" | "document" | "rollout">): string {
  const body = fenceClosed(plan.document.body.trimEnd());
  const title = `# ${plan.name.replace(WHITESPACE_RUN, " ").trim()}`;
  const rollout = rolloutSection(plan.rollout);
  return body.length === 0 ? `${title}\n\n${rollout}\n` : `${title}\n\n${body}\n\n${rollout}\n`;
}
