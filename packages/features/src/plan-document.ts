import { PLAN_SECTION_BOUNDS, type PlanActor, type PlanEditor } from "./task-wire.js";

/**
 * plan-document.ts -- a plan kept as one free Markdown document: its sections, and who last changed each.
 *
 * A plan is one Markdown text the developer and Luke both write, started
 * from the account's own template (`docs/TASKS.md`). The text has no title line,
 * since the plan's name is its own, and its assumptions are a section like
 * any other. A section is a `#` or `##` heading and everything up to the
 * next one, a deeper heading standing inside its section, and a heading
 * inside a code fence being no heading at all; what stands before the first
 * heading is a section of its own with no heading. A section is known by its
 * heading's words, so the window can say who wrote each section. Who last
 * changed each is read off the plan's revisions, each against the one before
 * it, and a heading renamed with nothing beneath it changed is the same
 * section under its new words, still naming the save that last changed them.
 */

/**
 * Who last changed one section of a plan that is one document, and when: the
 * section's heading, the writer (`PLAN_ACTOR`), the coding agent's id where
 * an agent wrote the revision, whether the notetaker wrote it on one of the
 * task's calls, and the revision's latest save.
 */
export interface PlanSectionWriter {
  readonly section: string;
  readonly actor: PlanActor;
  /** The coding agent's id, where a coding agent wrote the revision. */
  readonly agentId?: string;
  /** Present, and true, where the notetaker wrote the revision on one of the task's calls. */
  readonly duringCall?: boolean;
  /** The member who wrote the revision, where the service can name one (`task-wire.ts`'s `planEditorSchema`). */
  readonly by?: PlanEditor;
  /** Epoch milliseconds of the revision's latest save. */
  readonly at: number;
}

/** Who wrote a revision, as each section it changed names them. */
export type PlanSectionWriterWho = Omit<PlanSectionWriter, "section" | "at">;

/**
 * One section of a document: the heading it is known by, empty for what
 * stands before the first, its lines, the heading's among them, with the
 * blank lines after them left out, and where those lines stand in the text.
 */
export interface PlanSection {
  readonly heading: string;
  readonly text: string;
  /** The offset of the section's first character in the text. */
  readonly from: number;
  /** The offset just past its last character, before the blank lines that follow it. */
  readonly to: number;
}

/** A code fence's opening line: up to three spaces, then three or more backticks or tildes, then any info string. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

/** A code fence's closing line: up to three spaces, the run, and nothing after it but spaces, since a closing fence takes no info string. */
const CLOSING_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;

/** What opens a `#` or `##` heading line: up to three spaces, the hashes, then a space, a tab, or the line's end. */
const SECTION_OPENER = /^ {0,3}#{1,2}(?=[ \t]|$)/u;

/** The fence open after a line, given the one open before it: a line opens one outside a fence and closes the one it matches inside it. */
function fenceAfter(open: string | undefined, line: string): string | undefined {
  const fence = (open === undefined ? FENCE_LINE : CLOSING_FENCE_LINE).exec(line)?.[1];
  if (fence === undefined) return open;
  if (open === undefined) return fence;
  return fence[0] === open[0] && fence.length >= open.length ? undefined : open;
}

/**
 * The fence still open where a line of the text starts at or past `offset`,
 * as the run that opened it, or nothing where `offset` stands outside every
 * fence: what a note writing there must not write into, or must close first.
 */
export function openFenceAt(text: string, offset: number): string | undefined {
  let open: string | undefined;
  let at = 0;
  for (const line of text.split("\n")) {
    if (at + line.length >= offset) break;
    open = fenceAfter(open, line);
    at += line.length + 1;
  }
  return open;
}

/** A section while its lines are read: its heading, where it starts, and the lines so far. */
interface SectionLines {
  readonly heading: string;
  readonly from: number;
  readonly lines: string[];
}

/**
 * A heading's words with the closing hashes CommonMark allows left out: a
 * run of them at the end, standing behind a space or alone. Note that they
 * are walked by hand rather than matched, because a pattern over a run of
 * spaces and hashes backtracks across every long run it finds no end in.
 */
function withoutClosingHashes(words: string): string {
  let end = words.length;
  while (end > 0 && words[end - 1] === "#") end -= 1;
  if (end === words.length) return words;
  if (end === 0) return "";
  const before = words[end - 1];
  return before === " " || before === "\t" ? words.slice(0, end).trimEnd() : words;
}

/** The words a heading line is known by, cut to the bound, or nothing for a line that opens no section. */
function headingOf(line: string): string | undefined {
  const opener = SECTION_OPENER.exec(line);
  if (opener === null) return undefined;
  const words = withoutClosingHashes(line.slice(opener[0].length).trim());
  return words.slice(0, PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS);
}

/**
 * The document's sections in order. Note that a fence is closed only by a
 * line of the same character at least as long as the one that opened it and
 * holding nothing after the run, as CommonMark has it, because a shorter
 * run, or one labelled like an opening, inside a fence is code.
 */
export function planSections(text: string): readonly PlanSection[] {
  const sections: SectionLines[] = [];
  let open: string | undefined;
  let current: SectionLines = { heading: "", from: 0, lines: [] };
  let offset = 0;
  for (const line of text.split("\n")) {
    const heading = open === undefined ? headingOf(line) : undefined;
    if (heading !== undefined) {
      if (current.heading !== "" || current.lines.some((each) => each.trim() !== "")) {
        sections.push(current);
      }
      current = { heading, from: offset, lines: [] };
    }
    current.lines.push(line);
    offset += line.length + 1;
    open = fenceAfter(open, line);
  }
  if (current.heading !== "" || current.lines.some((each) => each.trim() !== "")) {
    sections.push(current);
  }
  return sections.map(({ heading, from, lines }) => {
    const words = lines.join("\n").trimEnd();
    return { heading, text: words, from, to: from + words.length };
  });
}

/** Each heading's sections' words, in the order they stand, so two sections under one heading are compared one by one. */
function wordsByHeading(text: string): ReadonlyMap<string, readonly string[]> {
  const byHeading = new Map<string, string[]>();
  for (const section of planSections(text)) {
    byHeading.set(section.heading, [...(byHeading.get(section.heading) ?? []), section.text]);
  }
  return byHeading;
}

/**
 * The headings whose sections a change from `before` to `after` moved, each
 * once: those `after` holds that differ, in its order, then those only
 * `before` held, which the change struck.
 */
export function changedSections(before: string, after: string): readonly string[] {
  const was = wordsByHeading(before);
  const now = wordsByHeading(after);
  const changed: string[] = [];
  for (const [heading, words] of now) {
    const then = was.get(heading) ?? [];
    const same = then.length === words.length && words.every((each, at) => each === then[at]);
    if (!same) changed.push(heading);
  }
  return [...changed, ...[...was.keys()].filter((heading) => !now.has(heading))];
}

/** A section's words beneath its heading line, which renaming the heading alone leaves as they stood. */
function wordsBeneath(section: PlanSection): string {
  const end = section.text.indexOf("\n");
  return end === -1 ? "" : section.text.slice(end + 1);
}

/** How many of the sections hold each run of words beneath their heading. */
function countBeneath(sections: readonly PlanSection[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const section of sections) {
    const words = wordsBeneath(section);
    counts.set(words, (counts.get(words) ?? 0) + 1);
  }
  return counts;
}

/**
 * The headings a change renamed and nothing else, each new heading to the
 * one it replaced: a heading only `after` holds whose words beneath stand
 * exactly as those of a heading only `before` held. Note that a pair is
 * taken only where those words name one heading on each side, because two
 * empty sections, one struck and one renamed, cannot be told apart, and an
 * arbitrary writer carried over is worse than the renamer named.
 */
function renamedHeadings(
  before: readonly PlanSection[],
  after: readonly PlanSection[],
): ReadonlyMap<string, string> {
  const was = new Set(before.map((section) => section.heading));
  const now = new Set(after.map((section) => section.heading));
  const gone = before.filter((section) => section.heading !== "" && !now.has(section.heading));
  const arrived = after.filter((section) => section.heading !== "" && !was.has(section.heading));
  const goneCounts = countBeneath(gone);
  const arrivedCounts = countBeneath(arrived);
  const renamed = new Map<string, string>();
  for (const section of arrived) {
    const words = wordsBeneath(section);
    const old = gone.find((each) => wordsBeneath(each) === words);
    const alone = goneCounts.get(words) === 1 && arrivedCounts.get(words) === 1;
    if (old !== undefined && alone) renamed.set(section.heading, old.heading);
  }
  return renamed;
}

/**
 * The sections' writers after a revision by `who` at `at` that took the text
 * from `before` to `after`: each section it changed now names it, a section
 * it only renamed keeps the writer it had under its new heading, every other
 * section still standing keeps the writer it had, and a section the text no
 * longer holds keeps none. The newest are kept past the bound.
 */
function withSectionWriters(
  writers: readonly PlanSectionWriter[],
  change: { readonly before: string; readonly after: string },
  who: PlanSectionWriterWho,
  at: number,
): readonly PlanSectionWriter[] {
  const after = planSections(change.after);
  const renamed = renamedHeadings(planSections(change.before), after);
  const standing = new Set(after.map((section) => section.heading));
  const changed = changedSections(change.before, change.after).filter(
    (heading) => standing.has(heading) && !renamed.has(heading),
  );
  const renamedTo = new Map([...renamed].map(([heading, old]) => [old, heading]));
  const kept = writers.flatMap((writer) => {
    const section = renamedTo.get(writer.section) ?? writer.section;
    return standing.has(section) && !changed.includes(section) ? [{ ...writer, section }] : [];
  });
  const written = [...kept, ...changed.map((section) => ({ section, ...who, at }))];
  return written.slice(-PLAN_SECTION_BOUNDS.MAX_SECTIONS);
}

/** One revision of a plan as its sections' writers are read off it: its text, and who wrote it, when. */
export interface SectionRevision {
  readonly text: string;
  readonly who: PlanSectionWriterWho;
  /** Epoch milliseconds of the revision's latest save. */
  readonly at: number;
}

/**
 * Who last changed each section of a plan, read off its revisions, oldest
 * first, each against the text before it, the first against `base`: the
 * newest revision that changed a section names its writer on it. Note that a
 * revision is one writer's saves joined, and keeps only the text they left,
 * so a section is named with the revision's latest save, and one changed and
 * changed back within a revision is no change of it.
 */
export function sectionWritersOf(
  base: string,
  revisions: readonly SectionRevision[],
): readonly PlanSectionWriter[] {
  let writers: readonly PlanSectionWriter[] = [];
  let before = base;
  for (const revision of revisions) {
    writers = withSectionWriters(
      writers,
      { before, after: revision.text },
      revision.who,
      revision.at,
    );
    before = revision.text;
  }
  return writers;
}
