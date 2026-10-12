import { type PlanSection, planSections } from "@sidecar/hosted/plan-document";
import { PLAN_HEADING } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  type PlanDocument,
  type PlanLastEdit,
  type PlanRevisionLine,
} from "@sidecar/hosted/plan-wire";
import { diffArrays } from "diff";
import { MARKDOWN_MARK, type MarkdownMark } from "../markdown-message";
import { isPlaceholder, type WordChange, wordChanges } from "./plan-diff";

/**
 * plan-history-model.ts -- the version history's words for each revision, and a version of the plan drawn against another with its changes marked.
 *
 * A revision is named the way the "Edited by" line names its writer: Luke
 * for the notetaker, You for the developer, a coding agent by its title, and
 * Earlier for the plan as it stood before its history began. Its line says
 * what it did: how many changes its saves made, or which version a restore
 * brought back. A version is drawn whole, a unit to each section of its
 * body (`planSections`, as the open plan cuts it in `plan-reveal.ts`), each
 * unit beside the unit under the same heading in the plan it is compared
 * with: a unit only one of them holds is drawn added or struck whole, and a
 * unit both hold that differs is drawn with its words written in and struck
 * out where they changed, word by word (`plan-diff.ts`). A plan of the
 * template's fields has its assumptions compared as a list. A plan that is
 * one document holds its assumptions in its text, and its versions are
 * drawn under its name; a version from before it was one document is drawn
 * as the document would hold it, so the two compare by what each draws. A
 * section's "Edited by" names the save that last changed it, which is found
 * as the revision it moved on. Everything here is pure.
 */

/** A section as a version compares it: its heading and its words, wherever they stood. */
type SectionWords = Pick<PlanSection, "heading" | "text">;

/** How a unit or an assumption of a version stands against the plan it is compared with. */
export const VERSION_CHANGE = {
  SAME: "same",
  ADDED: "added",
  REMOVED: "removed",
  CHANGED: "changed",
} as const;

type VersionChange = (typeof VERSION_CHANGE)[keyof typeof VERSION_CHANGE];

/** One unit of a version as drawn: its words, how it stands, and, for one changed, the stretches of its words written in and struck out. */
interface VersionUnit {
  readonly key: string;
  readonly words: string;
  readonly change: VersionChange;
  readonly marks: readonly MarkdownMark[];
}

/** One assumption of a version as drawn: its words, and whether it is new, struck, or kept. */
interface VersionAssumption {
  readonly text: string;
  readonly change: Exclude<VersionChange, typeof VERSION_CHANGE.CHANGED>;
}

/** A version drawn against another: its units, its assumptions, and whether anything differs at all. */
export interface VersionDiff {
  readonly units: readonly VersionUnit[];
  readonly assumptions: readonly VersionAssumption[];
  readonly changed: boolean;
}

/** A day and a time in the fewest words a version is named by: "Oct 11, 2:14 PM". */
const DAY_AND_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** The moment a version was saved, as the version history names it. */
export function versionMoment(at: number): string {
  return DAY_AND_TIME.format(at);
}

/** Who wrote a revision, as the version history names them. */
export function revisionAuthor(edit: PlanLastEdit): string {
  switch (edit.actor) {
    case PLAN_ACTOR.DEVELOPER:
      return "You";
    case PLAN_ACTOR.NOTETAKER:
      return "Luke";
    case PLAN_ACTOR.AGENT:
      return edit.label ?? "A coding agent";
    case PLAN_ACTOR.EARLIER:
      return "Earlier";
  }
}

/** What a revision did, in a few words: the version a restore brought back, the plan before history, or how many changes its saves made. */
export function revisionSummary(line: PlanRevisionLine): string {
  if (line.restoredFrom !== undefined) {
    return `Restored the version from ${versionMoment(line.restoredFrom.at)}`;
  }
  if (line.lastEdit.actor === PLAN_ACTOR.EARLIER) return "The plan before its history began";
  return line.changes === 1 ? "1 change" : `${line.changes} changes`;
}

/**
 * The revision that made the save at `at`, among revisions read newest
 * first: the oldest whose latest save is at or after it. A save moves its
 * revision's latest save on to its own moment or just past it, and every
 * revision older than that one last moved before the save, so the first
 * revision older than the save stands just past the one that made it.
 * Nothing where every revision read is at or after the save and an older
 * page is still to be read (`complete` false), since the one that made it
 * may stand there; the oldest where none is.
 */
export function revisionOfSave(
  revisions: readonly PlanRevisionLine[],
  at: number,
  complete: boolean,
): number | undefined {
  const before = revisions.findIndex((line) => line.lastEdit.at < at);
  if (before === -1) return complete ? revisions.at(-1)?.seq : undefined;
  // A save newer than the newest revision is the newest's, as close as the history comes.
  return (revisions[before - 1] ?? revisions[before])?.seq;
}

/** A run of whitespace, line breaks among it, which a title line and a list item spell as one space. */
const WHITESPACE_RUN = /\s+/gu;

/** A space between two words that changed, which a reader takes as part of the change around it. */
const LONE_SPACE = /^[^\S\n]+$/u;

/** Words that open a block of their own: a list item, a heading, a quote, or a table row. */
const BLOCK_OPENING = /^[^\S\n]*(?:[-*+]\s|\d{1,9}[.)]\s|#{1,6}\s|>|\|)/u;

/** A list item's opening, which a list item written after a struck one continues the list with. */
const LIST_OPENING = /^[^\S\n]*(?:[-*+]|\d{1,9}[.)])\s/u;

/**
 * What stands between words struck and the words written in their place: a
 * line break where either side is a block or spans lines, so a struck list
 * item and the line that replaced it are each drawn as what they are rather
 * than run together, and nothing where the change is inside a line.
 */
function betweenStruckAndWritten(struck: string, written: string): string {
  if (struck.endsWith("\n") || written.startsWith("\n")) return "";
  const blocks = BLOCK_OPENING.test(struck) || BLOCK_OPENING.test(written) || struck.includes("\n");
  if (!blocks) return "";
  return LIST_OPENING.test(struck) && LIST_OPENING.test(written) ? "\n" : "\n\n";
}

/**
 * The word changes of a unit cut into runs a reader sees: each stretch of
 * words struck, then the words written in its place, a lone space between
 * two changed words folded into both, so "Only admins" becoming "Any member"
 * reads as one phrase struck and one written rather than word by word. A
 * field's empty placeholder is not the plan's words, so one answered is not
 * drawn struck, and one a field went back to is drawn as it stands.
 */
function readerRuns(changes: readonly WordChange[]): readonly WordChange[] {
  const runs: WordChange[] = [];
  let struck = "";
  let written = "";
  const settle = () => {
    if (struck !== "" && !isPlaceholder(struck)) {
      runs.push({ words: struck, added: false, removed: true });
      const between = written === "" ? "" : betweenStruckAndWritten(struck, written);
      if (between !== "") runs.push({ words: between, added: false, removed: false });
    }
    if (written !== "") {
      const placeholder = isPlaceholder(written);
      runs.push({ words: written, added: !placeholder, removed: false });
    }
    struck = "";
    written = "";
  };
  changes.forEach((change, at) => {
    const next = changes[at + 1];
    const between =
      !change.added &&
      !change.removed &&
      LONE_SPACE.test(change.words) &&
      (struck !== "" || written !== "");
    if (between && next !== undefined && (next.added || next.removed)) {
      struck += change.words;
      written += change.words;
      return;
    }
    if (change.removed) struck += change.words;
    else if (change.added) written += change.words;
    else {
      settle();
      runs.push(change);
    }
  });
  settle();
  return runs;
}

/**
 * One unit both plans hold: the same, or its words merged, struck words
 * before the words that replace them, each stretch marked. Note that a unit
 * left with nothing marked is the same, because its only difference was a
 * field's placeholder giving way to nothing, as a section of the template's
 * fields does when the plan becomes one document.
 */
function pairedUnit(base: string, shown: SectionWords): VersionUnit {
  const key = shown.heading;
  if (base === shown.text) {
    return { key, words: shown.text, change: VERSION_CHANGE.SAME, marks: [] };
  }
  let words = "";
  const marks: MarkdownMark[] = [];
  for (const change of readerRuns(wordChanges(base, shown.text))) {
    const from = words.length;
    words += change.words;
    if (change.added) marks.push({ from, to: words.length, kind: MARKDOWN_MARK.INSERTED });
    if (change.removed) marks.push({ from, to: words.length, kind: MARKDOWN_MARK.DELETED });
  }
  const change = marks.length === 0 ? VERSION_CHANGE.SAME : VERSION_CHANGE.CHANGED;
  return { key, words, change, marks };
}

/** A unit only one plan holds, drawn whole as added or struck. */
function loneUnit(
  section: SectionWords,
  change: typeof VERSION_CHANGE.ADDED | typeof VERSION_CHANGE.REMOVED,
) {
  return { key: section.heading, words: section.text, change, marks: [] } satisfies VersionUnit;
}

/**
 * The units of the version shown against the base's, in reading order. The
 * units are lined up by their headings; a run struck and the run written in
 * its place are paired one for one, so a section that took another's place
 * reads as one unit changed rather than one gone and one new.
 */
function unitsAgainst(
  base: readonly SectionWords[],
  shown: readonly SectionWords[],
): VersionUnit[] {
  const headingOf = (section: SectionWords) => section.heading;
  const runs = diffArrays(base.map(headingOf), shown.map(headingOf));
  const units: VersionUnit[] = [];
  let atBase = 0;
  let atShown = 0;
  let struck: SectionWords[] = [];
  const settle = (written: readonly SectionWords[]) => {
    const paired = Math.min(struck.length, written.length);
    written.slice(0, paired).forEach((section, at) => {
      units.push(pairedUnit(struck[at]?.text ?? "", section));
    });
    for (const gone of struck.slice(paired)) units.push(loneUnit(gone, VERSION_CHANGE.REMOVED));
    for (const added of written.slice(paired)) units.push(loneUnit(added, VERSION_CHANGE.ADDED));
    struck = [];
  };
  for (const run of runs) {
    const count = run.value.length;
    if (run.removed) {
      struck = [...struck, ...base.slice(atBase, atBase + count)];
      atBase += count;
      continue;
    }
    const taken = shown.slice(atShown, atShown + count);
    atShown += count;
    if (run.added) {
      settle(taken);
      continue;
    }
    settle([]);
    taken.forEach((section, at) => {
      units.push(pairedUnit(base[atBase + at]?.text ?? "", section));
    });
    atBase += count;
  }
  settle([]);
  return units;
}

/** The assumptions of the version shown against the base's, in reading order, a reworded one struck and written again. */
function assumptionsAgainst(base: PlanDocument, shown: PlanDocument): VersionAssumption[] {
  const texts = (document: PlanDocument) => document.assumptions.map(({ text }) => text);
  return diffArrays(texts(base), texts(shown)).flatMap((run) =>
    run.value.map(
      (text): VersionAssumption => ({
        text,
        change: run.added
          ? VERSION_CHANGE.ADDED
          : run.removed
            ? VERSION_CHANGE.REMOVED
            : VERSION_CHANGE.SAME,
      }),
    ),
  );
}

/** An assumptions list as the section a document holds it in: its heading over one item a line, or its heading alone while it is empty. */
function assumptionsSection(document: PlanDocument): SectionWords {
  const heading = PLAN_HEADING.ASSUMPTIONS;
  const items = document.assumptions.map(({ text }) => `- ${text.replace(WHITESPACE_RUN, " ")}`);
  const blocks = [`## ${heading}`, ...(items.length === 0 ? [] : [items.join("\n")])];
  return { heading, text: blocks.join("\n\n") };
}

/** The headings a body of the template's fields holds under its title line, in its order. */
const FIELD_BODY_HEADINGS = [
  PLAN_HEADING.CONTEXT,
  PLAN_HEADING.GOAL,
  PLAN_HEADING.APPROACH,
  PLAN_HEADING.INTERFACES,
  PLAN_HEADING.ALTERNATIVES,
  PLAN_HEADING.HARD_PARTS,
  PLAN_HEADING.NOT_DOING,
  PLAN_HEADING.PLAN_OF_ATTACK,
  PLAN_HEADING.TESTING,
  PLAN_HEADING.OPEN_QUESTIONS,
] as const;

/** The sections a body of the template's fields leaves out while they hold nothing. */
const OPTIONAL_FIELD_HEADINGS: ReadonlySet<string> = new Set([
  PLAN_HEADING.ALTERNATIVES,
  PLAN_HEADING.PLAN_OF_ATTACK,
]);

/** Whether a section is the `# title` line a body of the template's fields opens with, alone. */
function isTitleLine(section: SectionWords | undefined, title: string): boolean {
  return section?.text === `# ${title.replace(WHITESPACE_RUN, " ").trim()}`;
}

/**
 * Whether sections are a body of the template's fields as the service
 * formats one under `title`: the `# title` line alone, then the template's
 * sections in its order, the optional ones where answered, and nothing else.
 * Note that we read the whole shape and not the title line alone, because a
 * document may open with a section of its own named as the plan is.
 */
function isFieldBody(sections: readonly SectionWords[], title: string): boolean {
  const [first, ...rest] = sections;
  if (!isTitleLine(first, title)) return false;
  const headings = rest.map((section) => section.heading);
  const expected = FIELD_BODY_HEADINGS.filter(
    (heading) => !OPTIONAL_FIELD_HEADINGS.has(heading) || headings.includes(heading),
  );
  return (
    headings.length === expected.length && headings.every((heading, at) => heading === expected[at])
  );
}

/**
 * The sections a version draws under a plan that is one document, titled
 * `title`. Note that a version from before the plan was one document opens
 * with its `# title` line and keeps its assumptions in a list beside its
 * body, because the service formats it under the plan's name as it stands
 * now. That line is the title drawn over every version, and that list is the
 * section the document holds its assumptions in, so it draws what the
 * document would. A document's own revision has no list, so one with no
 * list is read as the fields' only where its whole shape is theirs.
 */
function documentSections(document: PlanDocument, title: string): readonly SectionWords[] {
  const sections = planSections(document.body);
  const fielded = document.assumptions.length > 0 || isFieldBody(sections, title);
  if (!fielded) return sections;
  const body = isTitleLine(sections[0], title) ? sections.slice(1) : sections;
  return [...body, assumptionsSection(document)];
}

/**
 * A version of the plan drawn against another, or drawn as it is against
 * nothing, as the first version is: every unit and assumption of either,
 * each marked by how it stands. With `title`, the name of a plan that is
 * one document, each version is drawn as that document draws it, its
 * assumptions among its sections, and there is no list to compare.
 */
export function versionDiff(
  base: PlanDocument | null,
  shown: PlanDocument,
  title?: string,
): VersionDiff {
  const sectionsOf = (document: PlanDocument) =>
    title === undefined ? planSections(document.body) : documentSections(document, title);
  const units =
    base === null
      ? sectionsOf(shown).map((section) => pairedUnit(section.text, section))
      : unitsAgainst(sectionsOf(base), sectionsOf(shown));
  const assumptions = title === undefined ? assumptionsAgainst(base ?? shown, shown) : [];
  const changed =
    units.some((unit) => unit.change !== VERSION_CHANGE.SAME) ||
    assumptions.some((assumption) => assumption.change !== VERSION_CHANGE.SAME);
  return { units, assumptions, changed };
}
