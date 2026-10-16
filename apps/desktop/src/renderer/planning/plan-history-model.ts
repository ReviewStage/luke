import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { type WordChange, wordChanges } from "@luke/features/plan-diff";
import { type PlanSection, planSections } from "@luke/features/plan-document";
import {
  PLAN_ACTOR,
  type PlanDocument,
  type PlanEditor,
  type PlanRevisionLine,
} from "@luke/features/plan-wire";
import type { FormerMember, WorkspaceMember } from "@luke/features/workspace-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  actorName,
  LUKE_ACTOR,
  type PersonActor,
  personActor,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { diffArrays } from "diff";
import { MARKDOWN_MARK, type MarkdownMark } from "../markdown-message";
import { providerOf } from "./coding-agent-model";
import { dayAndTimeText } from "./plan-time";

/**
 * plan-history-model.ts -- the version history's words for each revision, and a version of the plan drawn against another with its changes marked.
 *
 * A revision is drawn under its writer the way the rest of the window draws
 * them (`@luke/ui/actor-model`): Luke for the notetaker, the reader by their
 * account's picture as You, a teammate as the workspace's members list them,
 * a coding agent by its harness and title, and Earlier for the plan as it
 * stood before its history began. Its line says
 * what it did: how many changes its saves made, or which version a restore
 * brought back. A version is drawn whole, a unit to each section of its
 * body (`planSections`, as the open plan cuts it in `plan-reveal.ts`), each
 * unit beside the unit under the same heading in the plan it is compared
 * with: a unit only one of them holds is drawn added or struck whole, and a
 * unit both hold that differs is drawn with its words written in and struck
 * out where they changed, word by word (`plan-diff.ts`). A section's
 * "Edited by" names the save that last changed it, which is found
 * as the revision it moved on. Everything here is pure.
 */

/** A section as a version compares it: its heading and its words, wherever they stood. */
type SectionWords = Pick<PlanSection, "heading" | "text">;

/** How a unit of a version stands against the plan it is compared with. */
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

/** A version drawn against another: its units, and whether anything differs at all. */
export interface VersionDiff {
  readonly units: readonly VersionUnit[];
  readonly changed: boolean;
}

/**
 * The one reading the history, as their account names them: none while no
 * account is signed in. The id is what tells their revisions from a
 * teammate's; without one, nobody is drawn as them.
 */
export interface HistoryReader {
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly pictureUrl: string | undefined;
  /** The workspace's members as last read, which add a teammate's picture and say who has left; none while unread. */
  readonly members?: readonly WorkspaceMember[];
  /** Who the workspace's work names but left, whose pictures they keep, grayed; none while unread. */
  readonly former?: readonly FormerMember[];
}

/**
 * The member a person's revision names, as its row draws them: the reader,
 * by their own name and picture, where it is theirs or where every revision
 * is (`own`, the account's template); a teammate as the members read lists
 * them, or as a former member where it no longer does; someone unnamed
 * where the service names nobody.
 */
function personOf(by: PlanEditor | undefined, reader: HistoryReader, own: boolean): Actor {
  const yours = own || (by !== undefined && reader.id !== undefined && by.userId === reader.id);
  if (!yours) return personActor(by, reader.members, undefined, reader.former);
  const you: PersonActor = {
    kind: ACTOR_KIND.PERSON,
    userId: reader.id ?? "",
    name: reader.name ?? "",
    you: true,
  };
  return reader.pictureUrl === undefined ? you : { ...you, pictureUrl: reader.pictureUrl };
}

/**
 * Who wrote a revision: a member, the reader as You only where the revision
 * names them, or every revision where `own` says the history is theirs
 * alone; Luke; a coding agent by the title its row has now, wearing
 * the harness of the agent the line names among the plan's `agents`, or no
 * harness where the agent is not among them; or the plan before history.
 */
export function revisionAuthorOf(
  line: Pick<PlanRevisionLine, "lastEdit" | "agentId">,
  reader: HistoryReader,
  agents: readonly Pick<CodingAgentSummary, "id" | "model">[],
  own = false,
): Actor {
  const { lastEdit } = line;
  switch (lastEdit.actor) {
    case PLAN_ACTOR.DEVELOPER:
      return personOf(lastEdit.by, reader, own);
    case PLAN_ACTOR.NOTETAKER:
      return LUKE_ACTOR;
    case PLAN_ACTOR.AGENT: {
      const agent = agents.find((each) => each.id === line.agentId);
      return {
        kind: ACTOR_KIND.AGENT,
        name: lastEdit.label ?? TAB_WORDS.CODING_AGENT,
        provider: agent === undefined ? undefined : providerOf(agent.model),
        state: ACTOR_STATE.REST,
      };
    }
    case PLAN_ACTOR.EARLIER:
      return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.EARLIER };
  }
}

/** What a revision did, in a few words: the version a restore brought back, the plan before history, or how many changes its saves made. */
export function revisionSummary(line: PlanRevisionLine): string {
  if (line.restoredFrom !== undefined) {
    return `Restored the version from ${dayAndTimeText(line.restoredFrom.at)}`;
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
 * reads as one phrase struck and one written rather than word by word.
 */
function readerRuns(changes: readonly WordChange[]): readonly WordChange[] {
  const runs: WordChange[] = [];
  let struck = "";
  let written = "";
  const settle = () => {
    if (struck !== "") {
      runs.push({ words: struck, added: false, removed: true });
      const between = written === "" ? "" : betweenStruckAndWritten(struck, written);
      if (between !== "") runs.push({ words: between, added: false, removed: false });
    }
    if (written !== "") runs.push({ words: written, added: true, removed: false });
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
 * before the words that replace them, each stretch marked.
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

/**
 * A version of the plan drawn against another, or drawn as it is against
 * nothing, as the first version is: every unit of either, each marked by
 * how it stands.
 */
export function versionDiff(base: PlanDocument | null, shown: PlanDocument): VersionDiff {
  const sectionsOf = (document: PlanDocument) => planSections(document.body);
  const units =
    base === null
      ? sectionsOf(shown).map((section) => pairedUnit(section.text, section))
      : unitsAgainst(sectionsOf(base), sectionsOf(shown));
  const changed = units.some((unit) => unit.change !== VERSION_CHANGE.SAME);
  return { units, changed };
}

/** One section a revision changed, as its drill-in lists it: the unit of the version it is, its heading, and how it changed. */
export interface ChangedSection {
  /** Where the section stands among the version's units, which is how the page draws it alone. */
  readonly unit: number;
  readonly heading: string;
  readonly change: Exclude<VersionChange, typeof VERSION_CHANGE.SAME>;
}

/**
 * The sections a revision changed, in reading order: each unit of its diff
 * that is not the same as before, so the list names what the page marks. A
 * revision with nothing before it, the plan's first, wrote every section it
 * holds. Note that a revision is one writer's saves joined, and
 * the store keeps only the text they left, so a section is the finest step
 * a revision can be read in.
 */
export function changedSections(diff: VersionDiff, first: boolean): readonly ChangedSection[] {
  return diff.units.flatMap((unit, at): ChangedSection[] => {
    const change = first ? VERSION_CHANGE.ADDED : unit.change;
    if (change === VERSION_CHANGE.SAME) return [];
    return [{ unit: at, heading: unit.key, change }];
  });
}

/** Whether a revision's row opens the sections it changed: one whose saves made more than one change, never a restore or the plan before history. */
export function opensSections(line: PlanRevisionLine): boolean {
  return (
    line.changes > 1 &&
    line.restoredFrom === undefined &&
    line.lastEdit.actor !== PLAN_ACTOR.EARLIER
  );
}

/** What a section is called in a revision's list: its heading, or Opening for the words before the document's first heading. */
export function sectionName(heading: string): string {
  return heading === "" ? "Opening" : heading;
}

/** Where a revision was written, which its Open goes to. */
export const REVISION_SOURCE = {
  AGENT: "agent",
  CALL: "call",
  WORK: "work",
} as const;

/**
 * The place that wrote a revision: a coding agent's tab, the call Luke wrote
 * it on in the Transcript, or, for Luke's save on no call the history names,
 * the Call tab's turn at the moment it was saved.
 */
export type RevisionSource =
  | { readonly kind: typeof REVISION_SOURCE.AGENT; readonly agentId: string }
  | { readonly kind: typeof REVISION_SOURCE.CALL; readonly callId: string }
  | { readonly kind: typeof REVISION_SOURCE.WORK; readonly at: number };

/**
 * Where a revision's Open goes: an agent's tab where the line names the
 * agent, the call where it names one, the Call tab at its latest save for
 * Luke's other saves, and nowhere for the developer's own, a restore, or the
 * plan before history, which nothing else in the window wrote.
 */
export function revisionSource(
  line: Pick<PlanRevisionLine, "lastEdit" | "agentId" | "callId">,
): RevisionSource | undefined {
  const { lastEdit } = line;
  if (lastEdit.actor === PLAN_ACTOR.AGENT && line.agentId !== undefined) {
    return { kind: REVISION_SOURCE.AGENT, agentId: line.agentId };
  }
  if (lastEdit.actor !== PLAN_ACTOR.NOTETAKER) return undefined;
  return line.callId === undefined
    ? { kind: REVISION_SOURCE.WORK, at: lastEdit.at }
    : { kind: REVISION_SOURCE.CALL, callId: line.callId };
}

/** What a revision's Open says: the agent's tab by its writer's name, or the tab Luke's work stands in. */
export function sourceLabel(source: RevisionSource, author: Actor): string {
  switch (source.kind) {
    case REVISION_SOURCE.AGENT:
      return `Open ${actorName(author)}`;
    case REVISION_SOURCE.CALL:
      return "Open in Transcript";
    case REVISION_SOURCE.WORK:
      return "Open in Work";
  }
}
