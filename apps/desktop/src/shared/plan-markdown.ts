import { PLAN_BOUNDS, type PlanDocument } from "@sidecar/hosted/plan-wire";

/**
 * plan-markdown.ts -- a plan's saved document as the readable Markdown Copy puts on the clipboard.
 *
 * Copy is direct formatting of the saved document and nothing else: the body
 * exactly as saved, then an `## Assumptions` checklist drawn from the saved
 * list, `- [x]` for a confirmed assumption and `- [ ]` for one that is not.
 * It reads no flag as a gate: a document with every assumption unconfirmed
 * copies the same way as one with all of them confirmed, and before or after
 * the handoff prompt is written (`docs/PLANNING.md`, "Copy").
 */

const ASSUMPTIONS_HEADING = "## Assumptions";

const CHECKBOX = {
  CONFIRMED: "- [x] ",
  UNCONFIRMED: "- [ ] ",
} as const;

/** The characters the heading and the blank lines around it add to the body. */
const HEADING_OVERHEAD = ASSUMPTIONS_HEADING.length + 4;

/**
 * The most characters the Markdown of any document the store admits can
 * spell: the longest body, then the heading, then the most assumptions, each
 * at its longest behind its checkbox and on its own line. The copy act admits
 * this much, so no saved document is too long to copy.
 */
export const PLAN_MARKDOWN_MAX_CHARS =
  PLAN_BOUNDS.MAX_BODY_CHARS +
  HEADING_OVERHEAD +
  PLAN_BOUNDS.MAX_ASSUMPTIONS * (CHECKBOX.CONFIRMED.length + PLAN_BOUNDS.MAX_ASSUMPTION_CHARS + 1);

/**
 * One assumption as a checklist item. Note that we fold a line break inside
 * the text into a space, because a blank line would end the item and leave
 * the rest of the sentence outside the checklist.
 */
function checklistItem(text: string, confirmed: boolean): string {
  const oneLine = text.replace(/\s*\n\s*/gu, " ");
  return `${confirmed ? CHECKBOX.CONFIRMED : CHECKBOX.UNCONFIRMED}${oneLine}`;
}

/**
 * The document as Markdown: the body as saved, and the checklist after it
 * where the list holds anything. An empty document is empty text.
 */
export function planMarkdown(document: PlanDocument): string {
  const body = document.body.trimEnd();
  if (document.assumptions.length === 0) return body.length === 0 ? "" : `${body}\n`;
  const items = document.assumptions.map((assumption) =>
    checklistItem(assumption.text, assumption.confirmed),
  );
  const checklist = [ASSUMPTIONS_HEADING, "", ...items].join("\n");
  return body.length === 0 ? `${checklist}\n` : `${body}\n\n${checklist}\n`;
}
