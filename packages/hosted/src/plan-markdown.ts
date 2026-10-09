import { PLAN_EMPTY_TEXT, PLAN_HEADING } from "./plan-template.js";
import { PLAN_BOUNDS, type PlanDocument } from "./plan-wire.js";

/**
 * plan-markdown.ts -- a plan's saved document as the readable Markdown Copy puts on the clipboard and a coding agent is handed.
 *
 * Copy is direct formatting of the saved document and nothing else: the body
 * exactly as saved, which carries every section of the fixed template in its
 * canonical order, then the template's last section, `## Assumptions`, drawn
 * from the saved list, one bullet per assumption, or "None recorded" while
 * the list is empty. A draft with every field unanswered copies the same way
 * as a finished plan (`docs/PLANNING.md`, "Copy").
 */

const ASSUMPTIONS_HEADING = `## ${PLAN_HEADING.ASSUMPTIONS}`;

const BULLET = "- ";

const WHITESPACE = /\s/u;

/** The characters the heading and the blank lines around it add to the body. */
const HEADING_OVERHEAD = ASSUMPTIONS_HEADING.length + 4;

/**
 * The most characters the Markdown of any document the store admits can
 * spell: the longest body, then the heading, then the most assumptions, each
 * at its longest behind its bullet and on its own line. The copy act admits
 * this much, so no saved document is too long to copy.
 */
export const PLAN_MARKDOWN_MAX_CHARS =
  PLAN_BOUNDS.MAX_BODY_CHARS +
  HEADING_OVERHEAD +
  PLAN_BOUNDS.MAX_ASSUMPTIONS * (BULLET.length + PLAN_BOUNDS.MAX_ASSUMPTION_CHARS + 1);

/**
 * One assumption as a list item. Note that we fold a line break inside the
 * text into a space, with the whitespace run around it, because a blank line
 * would end the item and leave the rest of the sentence outside the list. A
 * run holding no break is kept as written. The fold is one pass over the
 * text rather than a `\s*\n\s*` replace, because that expression backtracks
 * across every long run of spaces it finds no break in, and the service
 * runs this on a saved document as a coding agent starts.
 */
function listItem(text: string): string {
  let item = BULLET;
  let run = "";
  let broken = false;
  for (const char of text) {
    if (WHITESPACE.test(char)) {
      run += char;
      broken ||= char === "\n";
      continue;
    }
    item += `${broken ? " " : run}${char}`;
    run = "";
    broken = false;
  }
  return item + (broken ? " " : run);
}

/**
 * The document as Markdown: the body as saved, then the assumptions'
 * section, which stands whether or not the list holds anything.
 */
export function planMarkdown(document: PlanDocument): string {
  const body = document.body.trimEnd();
  const items =
    document.assumptions.length === 0
      ? [PLAN_EMPTY_TEXT.NO_ASSUMPTIONS]
      : document.assumptions.map((assumption) => listItem(assumption.text));
  const list = [ASSUMPTIONS_HEADING, "", ...items].join("\n");
  return body.length === 0 ? `${list}\n` : `${body}\n\n${list}\n`;
}
