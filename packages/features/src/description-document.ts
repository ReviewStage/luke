import {
  DESCRIPTION_SECTION_BOUNDS,
  type DescriptionActor,
  type DescriptionEditor,
} from "./task-wire.js";

export interface DescriptionSectionWriter {
  readonly section: string;
  readonly actor: DescriptionActor;
  readonly agentId?: string;
  readonly by?: DescriptionEditor;
  readonly at: number;
}

export type DescriptionSectionWriterWho = Omit<DescriptionSectionWriter, "section" | "at">;

export interface DescriptionSection {
  readonly heading: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

const CLOSING_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;

const SECTION_OPENER = /^ {0,3}#{1,2}(?=[ \t]|$)/u;

function fenceAfter(open: string | undefined, line: string): string | undefined {
  const fence = (open === undefined ? FENCE_LINE : CLOSING_FENCE_LINE).exec(line)?.[1];
  if (fence === undefined) return open;
  if (open === undefined) return fence;
  return fence[0] === open[0] && fence.length >= open.length ? undefined : open;
}

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

interface SectionLines {
  readonly heading: string;
  readonly from: number;
  readonly lines: string[];
}

function withoutClosingHashes(words: string): string {
  let end = words.length;
  while (end > 0 && words[end - 1] === "#") end -= 1;
  if (end === words.length) return words;
  if (end === 0) return "";
  const before = words[end - 1];
  return before === " " || before === "\t" ? words.slice(0, end).trimEnd() : words;
}

function headingOf(line: string): string | undefined {
  const opener = SECTION_OPENER.exec(line);
  if (opener === null) return undefined;
  const words = withoutClosingHashes(line.slice(opener[0].length).trim());
  return words.slice(0, DESCRIPTION_SECTION_BOUNDS.MAX_HEADING_CHARS);
}

export function descriptionSections(text: string): readonly DescriptionSection[] {
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

function wordsByHeading(text: string): ReadonlyMap<string, readonly string[]> {
  const byHeading = new Map<string, string[]>();
  for (const section of descriptionSections(text)) {
    byHeading.set(section.heading, [...(byHeading.get(section.heading) ?? []), section.text]);
  }
  return byHeading;
}

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

function wordsBeneath(section: DescriptionSection): string {
  const end = section.text.indexOf("\n");
  return end === -1 ? "" : section.text.slice(end + 1);
}

function countBeneath(sections: readonly DescriptionSection[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const section of sections) {
    const words = wordsBeneath(section);
    counts.set(words, (counts.get(words) ?? 0) + 1);
  }
  return counts;
}

function renamedHeadings(
  before: readonly DescriptionSection[],
  after: readonly DescriptionSection[],
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

function withSectionWriters(
  writers: readonly DescriptionSectionWriter[],
  change: { readonly before: string; readonly after: string },
  who: DescriptionSectionWriterWho,
  at: number,
): readonly DescriptionSectionWriter[] {
  const after = descriptionSections(change.after);
  const renamed = renamedHeadings(descriptionSections(change.before), after);
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
  return written.slice(-DESCRIPTION_SECTION_BOUNDS.MAX_SECTIONS);
}

export interface SectionRevision {
  readonly text: string;
  readonly who: DescriptionSectionWriterWho;
  readonly at: number;
}

export function sectionWritersOf(
  base: string,
  revisions: readonly SectionRevision[],
): readonly DescriptionSectionWriter[] {
  let writers: readonly DescriptionSectionWriter[] = [];
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
