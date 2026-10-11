import {
  PLAN_ACTOR,
  type PlanDocument,
  type PlanLastEdit,
  type PlanRevisionLine,
} from "@sidecar/hosted/plan-wire";
import { diffArrays } from "diff";
import { MARKDOWN_MARK, type MarkdownMark } from "../markdown-message";
import { agoText } from "./plan-body";
import { isPlaceholder, type WordChange, wordChanges } from "./plan-diff";
import { planUnits } from "./plan-reveal";

/**
 * plan-history-model.ts -- the History tab's words for each revision, and a version of the plan drawn against another with its changes marked.
 *
 * A revision is named the way the "Edited by" line names its writer: Luke
 * for the notetaker, You for the developer, a coding agent by its title, and
 * Earlier for the plan as it stood before its history began. Its line says
 * what it did: how many changes its saves made, or which version a restore
 * brought back. A version is drawn whole, unit by unit as the document cuts
 * its body (`plan-reveal.ts`), each unit beside the same unit of the plan it
 * is compared with: a unit only one of them holds is drawn added or struck
 * whole, and a unit both hold that differs is drawn with its words written
 * in and struck out where they changed, word by word (`plan-diff.ts`). The
 * assumptions are compared as a list. Everything here is pure.
 */

/** What a version is drawn against: the version before it, which shows what it changed, or the plan as it stands, which shows what restoring it would change. */
export const VERSION_COMPARE = {
  PREVIOUS: "previous",
  CURRENT: "current",
} as const;

export type VersionCompare = (typeof VERSION_COMPARE)[keyof typeof VERSION_COMPARE];

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

/** The moment a version was saved, as the History tab names it. */
export function versionMoment(at: number): string {
  return DAY_AND_TIME.format(at);
}

/** Who wrote a revision, as the History tab names them. */
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

/** The bar over a version: "Viewing version from 2h ago · Luke". */
export function versionHeading(line: PlanRevisionLine, now: number): string {
  return `Viewing version from ${agoText(line.lastEdit.at, now)} · ${revisionAuthor(line.lastEdit)}`;
}

/** A unit's key: its first line, which is its heading, or the plan's title for the first. */
function unitKey(words: string): string {
  const end = words.indexOf("\n");
  return end === -1 ? words : words.slice(0, end);
}

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

/** One unit both plans hold: the same, or its words merged, struck words before the words that replace them, each stretch marked. */
function pairedUnit(base: string, shown: string): VersionUnit {
  const key = unitKey(shown);
  if (base === shown) return { key, words: shown, change: VERSION_CHANGE.SAME, marks: [] };
  let words = "";
  const marks: MarkdownMark[] = [];
  for (const change of readerRuns(wordChanges(base, shown))) {
    const from = words.length;
    words += change.words;
    if (change.added) marks.push({ from, to: words.length, kind: MARKDOWN_MARK.INSERTED });
    if (change.removed) marks.push({ from, to: words.length, kind: MARKDOWN_MARK.DELETED });
  }
  return { key, words, change: VERSION_CHANGE.CHANGED, marks };
}

/** A unit only one plan holds, drawn whole as added or struck. */
function loneUnit(
  words: string,
  change: typeof VERSION_CHANGE.ADDED | typeof VERSION_CHANGE.REMOVED,
) {
  return { key: unitKey(words), words, change, marks: [] } satisfies VersionUnit;
}

/**
 * The units of the version shown against the base's, in reading order. The
 * units are lined up by their headings; a run struck and the run written in
 * its place are paired one for one, so a rule whose statement was reworded
 * reads as one rule changed rather than one gone and one new.
 */
function unitsAgainst(base: readonly string[], shown: readonly string[]): VersionUnit[] {
  const runs = diffArrays(base.map(unitKey), shown.map(unitKey));
  const units: VersionUnit[] = [];
  let atBase = 0;
  let atShown = 0;
  let struck: string[] = [];
  const settle = (written: readonly string[]) => {
    const paired = Math.min(struck.length, written.length);
    for (let at = 0; at < paired; at += 1) {
      units.push(pairedUnit(struck[at] ?? "", written[at] ?? ""));
    }
    for (const words of struck.slice(paired)) units.push(loneUnit(words, VERSION_CHANGE.REMOVED));
    for (const words of written.slice(paired)) units.push(loneUnit(words, VERSION_CHANGE.ADDED));
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
    taken.forEach((words, at) => {
      units.push(pairedUnit(base[atBase + at] ?? "", words));
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

/**
 * A version of the plan drawn against another, or drawn as it is against
 * nothing, as the first version is: every unit and assumption of either,
 * each marked by how it stands.
 */
export function versionDiff(base: PlanDocument | null, shown: PlanDocument): VersionDiff {
  const units =
    base === null
      ? planUnits(shown.body).map((words) => pairedUnit(words, words))
      : unitsAgainst(planUnits(base.body), planUnits(shown.body));
  const assumptions = assumptionsAgainst(base ?? shown, shown);
  const changed =
    units.some((unit) => unit.change !== VERSION_CHANGE.SAME) ||
    assumptions.some((assumption) => assumption.change !== VERSION_CHANGE.SAME);
  return { units, assumptions, changed };
}
