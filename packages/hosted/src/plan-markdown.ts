import { PLAN_EMPTY_TEXT, PLAN_HEADING } from "./plan-template.js";
import { PLAN_BOUNDS, type Plan } from "./plan-wire.js";

/**
 * plan-markdown.ts -- a plan's saved document as the readable Markdown Copy puts on the clipboard and a coding agent is handed.
 *
 * Copy is direct formatting of the saved document and nothing else: the body
 * as saved, which carries every section of the fixed template in its
 * canonical order, then the template's last section, `## Assumptions`, drawn
 * from the saved list, one bullet per assumption, or "None recorded" while
 * the list is empty. A draft with every field unanswered copies the same way
 * as a finished plan (`docs/PLANNING.md`, "Copy"). A plan that is one
 * document copies as its name for a title over its text, which holds its
 * assumptions itself.
 */

const ASSUMPTIONS_HEADING = `## ${PLAN_HEADING.ASSUMPTIONS}`;

const BULLET = "- ";

const WHITESPACE = /\s/u;

/** The characters the heading and the blank lines around it add to the body. */
const HEADING_OVERHEAD = ASSUMPTIONS_HEADING.length + 4;

/** A run of whitespace, line breaks among it, which a title spells as one space. */
const WHITESPACE_RUN = /\s+/gu;

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
 * The plan as Markdown. A plan that is one document, which answers no
 * fields, is its name as a title over its text. Any other is its body as
 * saved, whose heading is already the name, then the assumptions' section,
 * which stands whether or not the list holds anything.
 */
export function planMarkdown(plan: Pick<Plan, "name" | "document" | "fields">): string {
  const { document } = plan;
  const body = document.body.trimEnd();
  if (plan.fields === undefined) {
    const title = `# ${plan.name.replace(WHITESPACE_RUN, " ").trim()}`;
    return body.length === 0 ? `${title}\n` : `${title}\n\n${body}\n`;
  }
  const items =
    document.assumptions.length === 0
      ? [PLAN_EMPTY_TEXT.NO_ASSUMPTIONS]
      : document.assumptions.map((assumption) => listItem(assumption.text));
  const list = [ASSUMPTIONS_HEADING, "", ...items].join("\n");
  return body.length === 0 ? `${list}\n` : `${body}\n\n${list}\n`;
}
