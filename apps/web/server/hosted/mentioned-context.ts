import { MENTIONED_HEADING } from "@sidecar/database/models/attached-file-parts";
import { MENTION_KIND, mentionsIn, type PlanMention } from "@sidecar/hosted/mention-link";
import { planSections } from "@sidecar/hosted/plan-document";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import type { Plan } from "@sidecar/hosted/plan-wire";

/**
 * mentioned-context.ts -- what a coding agent's message mentions that the agent cannot read for itself, as it stood when the message was sent.
 *
 * A message names things as links whose label starts with `@`
 * (`@sidecar/hosted/mention-link`). The words go to the model as written,
 * links and all. A file or a folder is the agent's to read from its own
 * checkout, on its own branch, so nothing of it is added here. The plan, or
 * one of its sections, is not: a coding agent has no tool to read the plan
 * again, and one started on a task never saw it. So the message carries one
 * more part after its words, the plan or each section it named as it stood
 * at the send, under a heading eve's receipt is read back by
 * (`attached-file-parts.ts`). Only the agent's own plan is read, the plan the
 * send already read as its sender; a mention of another plan adds nothing.
 *
 * Each excerpt is cut on a line to its own bound, and the part to one bound
 * over all of them, in the order the mentions stand; an excerpt cut short
 * says how much was left out, and a mention the part has no room left for
 * is named with a line saying so, so the model knows to ask rather than
 * guess. A section whose heading the plan no longer holds is named as gone.
 */

export const MENTIONED_BOUNDS = {
  /** The most characters of one section the part carries. */
  SECTION_CHARS: 4_000,
  /** The most characters of the whole plan the part carries, before its remaining headings. */
  PLAN_CHARS: 12_000,
  /** The most characters the whole part carries, about six thousand tokens. */
  PART_CHARS: 24_000,
} as const;

/** The text cut on a line to the bound, saying how much was left out; whole where it fits. */
function cutOnLine(text: string, bound: number): string {
  if (text.length <= bound) return text;
  const lineEnd = text.lastIndexOf("\n", bound);
  const kept = text.slice(0, lineEnd > 0 ? lineEnd : bound).trimEnd();
  return `${kept}\n… (${text.length - kept.length} more characters)`;
}

/** What a mention of the plan or one of its sections is handed as. */
function excerptOf(mention: PlanMention, plan: Plan): string {
  if (mention.kind === MENTION_KIND.PLAN) {
    const whole = planMarkdown(plan);
    if (whole.length <= MENTIONED_BOUNDS.PLAN_CHARS) return `The whole plan:\n\n${whole.trimEnd()}`;
    const shown = cutOnLine(whole, MENTIONED_BOUNDS.PLAN_CHARS);
    const headings = planSections(plan.document.body)
      .filter((section) => section.heading !== "" && !shown.includes(section.heading))
      .map((section) => section.heading);
    const rest = headings.length === 0 ? "" : `\n\nIts other sections: ${headings.join("; ")}.`;
    return `The whole plan, cut short:\n\n${shown}${rest}`;
  }
  const section = planSections(plan.document.body).find((each) => each.heading === mention.heading);
  if (section === undefined) {
    return `The section "${mention.heading}": no longer in the plan.`;
  }
  return `The plan's section "${mention.heading}":\n\n${cutOnLine(section.text, MENTIONED_BOUNDS.SECTION_CHARS)}`;
}

/** The same mention, each named once whatever times the message names it. */
function sameMention(first: PlanMention, second: PlanMention): boolean {
  if (first.kind === MENTION_KIND.PLAN || second.kind === MENTION_KIND.PLAN) {
    return first.kind === second.kind;
  }
  return first.heading === second.heading;
}

/**
 * The part a message hands its agent beside its words: the plan or each of
 * its sections the words mention, as it stands in `plan`, the agent's own
 * plan as the send read it; nothing where they mention none of it.
 */
export function mentionedContext(words: string, plan: Plan): string | undefined {
  const named: PlanMention[] = [];
  for (const { mention } of mentionsIn(words)) {
    if (mention.kind !== MENTION_KIND.PLAN && mention.kind !== MENTION_KIND.SECTION) continue;
    if (mention.planId !== plan.id) continue;
    if (!named.some((each) => sameMention(each, mention))) named.push(mention);
  }
  if (named.length === 0) return undefined;
  let part = MENTIONED_HEADING;
  for (const mention of named) {
    const excerpt = excerptOf(mention, plan);
    const room = MENTIONED_BOUNDS.PART_CHARS - part.length - 2;
    part +=
      excerpt.length <= room
        ? `\n\n${excerpt}`
        : `\n\n${mention.kind === MENTION_KIND.PLAN ? "The whole plan" : `The section "${mention.heading}"`}: left out, since this part is full; ask for it if you need it.`;
  }
  return part;
}
