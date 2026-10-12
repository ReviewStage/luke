import { Schema as EffectSchema } from "effect";
import { PLAN_ACTOR, PLAN_SECTION_BOUNDS } from "./plan-wire.js";

/**
 * plan-document.ts -- a plan kept as one free Markdown document: its sections, and who last changed each.
 *
 * A plan is moving from the fixed template's fields (`plan-template.ts`) to
 * one Markdown text the developer and Luke both write, started from the
 * account's own template (`docs/PLANNING.md`). The text has no title line,
 * since the plan's name is its own, and its assumptions are a section like
 * any other. A section is a `#` or `##` heading and everything up to the
 * next one, a deeper heading standing inside its section, and a heading
 * inside a code fence being no heading at all; what stands before the first
 * heading is a section of its own with no heading. A section is known by its
 * heading's words, so the window can say who wrote each section the way it
 * said who wrote each field, and a renamed heading is a section no save has
 * changed yet.
 */

/**
 * Who last changed one section of a plan that is one document, and when: the
 * section's heading, the writer as a field's writer names one, the coding
 * agent's id where an agent made the save, whether the notetaker made it on
 * one of the plan's calls, and the instant.
 */
export const planSectionWriterSchema = EffectSchema.Struct({
  section: EffectSchema.String.check(
    EffectSchema.isMaxLength(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS),
  ),
  actor: EffectSchema.Literals(Object.values(PLAN_ACTOR)),
  /** The coding agent's id, where a coding agent made the save. */
  agentId: EffectSchema.optionalKey(EffectSchema.String),
  /** Present, and true, where the notetaker made the save on one of the plan's calls. */
  duringCall: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Epoch milliseconds of the save. */
  at: EffectSchema.Number,
});

export type PlanSectionWriter = typeof planSectionWriterSchema.Type;

/** Who made a save, as each section it changed keeps them. */
export type PlanSectionWriterWho = Omit<PlanSectionWriter, "section" | "at">;

/** One section of a document: the heading it is known by, empty for what stands before the first, and its lines, the heading's among them. */
export interface PlanSection {
  readonly heading: string;
  readonly text: string;
}

/** A code fence's opening or closing line: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

/** A `#` or `##` heading line, its words in the group, any closing hashes left out. */
const SECTION_HEADING = /^ {0,3}#{1,2}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;

/** A section while its lines are read: its heading, and the lines so far. */
interface SectionLines {
  readonly heading: string;
  readonly lines: string[];
}

/** The words a heading line is known by, cut to the bound, or nothing for a line that opens no section. */
function headingOf(line: string): string | undefined {
  const match = SECTION_HEADING.exec(line);
  if (match === null) return undefined;
  return (match[1] ?? "").trim().slice(0, PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS);
}

/**
 * The document's sections in order. Note that a fence is closed only by a
 * line of the same character at least as long as the one that opened it, as
 * CommonMark has it, because a shorter run inside a fence is code.
 */
export function planSections(text: string): readonly PlanSection[] {
  const sections: SectionLines[] = [];
  let open: string | undefined;
  let current: SectionLines = { heading: "", lines: [] };
  for (const line of text.split("\n")) {
    const fence = FENCE_LINE.exec(line)?.[1];
    const heading = open === undefined ? headingOf(line) : undefined;
    if (heading !== undefined) {
      if (current.heading !== "" || current.lines.some((each) => each.trim() !== "")) {
        sections.push(current);
      }
      current = { heading, lines: [] };
    }
    current.lines.push(line);
    if (fence === undefined) continue;
    if (open === undefined) open = fence;
    else if (fence[0] === open[0] && fence.length >= open.length) open = undefined;
  }
  if (current.heading !== "" || current.lines.some((each) => each.trim() !== "")) {
    sections.push(current);
  }
  return sections.map(({ heading, lines }) => ({ heading, text: lines.join("\n").trimEnd() }));
}

/** Each heading's sections' words, in the order they stand, so two sections under one heading are compared one by one. */
function wordsByHeading(text: string): ReadonlyMap<string, readonly string[]> {
  const byHeading = new Map<string, string[]>();
  for (const section of planSections(text)) {
    byHeading.set(section.heading, [...(byHeading.get(section.heading) ?? []), section.text]);
  }
  return byHeading;
}

/** The headings whose sections a change from `before` to `after` moved, each once, in the order `after` holds them. */
export function changedSections(before: string, after: string): readonly string[] {
  const was = wordsByHeading(before);
  const changed: string[] = [];
  for (const [heading, now] of wordsByHeading(after)) {
    const then = was.get(heading) ?? [];
    const same = then.length === now.length && now.every((words, at) => words === then[at]);
    if (!same) changed.push(heading);
  }
  return changed;
}

/**
 * The sections' writers after a save by `who` at `at` that took the text
 * from `before` to `after`: each section it changed now names it, every
 * other section still standing keeps the writer it had, and a section the
 * text no longer holds keeps none. The newest are kept past the bound.
 */
export function withSectionWriters(
  writers: readonly PlanSectionWriter[],
  change: { readonly before: string; readonly after: string },
  who: PlanSectionWriterWho,
  at: number,
): readonly PlanSectionWriter[] {
  const changed = changedSections(change.before, change.after);
  const standing = new Set(planSections(change.after).map((section) => section.heading));
  const kept = writers.filter(
    (writer) => standing.has(writer.section) && !changed.includes(writer.section),
  );
  const written = [...kept, ...changed.map((section) => ({ section, ...who, at }))];
  return written.slice(-PLAN_SECTION_BOUNDS.MAX_SECTIONS);
}
