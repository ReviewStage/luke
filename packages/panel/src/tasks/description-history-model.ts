import type { AgentSummary } from "@repo/features/agent-wire";
import { type WordChange, wordChanges } from "@repo/features/description-diff";
import { type DescriptionSection, descriptionSections } from "@repo/features/description-document";
import {
  DESCRIPTION_ACTOR,
  type DescriptionDocument,
  type DescriptionEditor,
  type DescriptionRevisionLine,
} from "@repo/features/task-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import type { FormerMember, WorkspaceMember } from "@repo/features/workspace-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  APP_ACTOR,
  actorName,
  type PersonActor,
  personActor,
  SOMEONE_REASON,
} from "@repo/ui/actor-model";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { diffArrays } from "diff";
import { MARKDOWN_MARK, type MarkdownMark } from "../markdown-message.js";
import { providerOf } from "./agent-model.js";

type SectionWords = Pick<DescriptionSection, "heading" | "text">;

export const VERSION_CHANGE = {
  SAME: "same",
  ADDED: "added",
  REMOVED: "removed",
  CHANGED: "changed",
} as const;

type VersionChange = (typeof VERSION_CHANGE)[keyof typeof VERSION_CHANGE];

interface VersionUnit {
  readonly key: string;
  readonly words: string;
  readonly change: VersionChange;
  readonly marks: readonly MarkdownMark[];
}

export interface VersionDiff {
  readonly units: readonly VersionUnit[];
  readonly changed: boolean;
}

export interface HistoryReader {
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly pictureUrl: string | undefined;
  readonly members?: readonly WorkspaceMember[];
  readonly former?: readonly FormerMember[];
}

function personOf(by: DescriptionEditor | undefined, reader: HistoryReader): Actor {
  const yours = by !== undefined && reader.id !== undefined && by.userId === reader.id;
  if (!yours) return personActor(by, reader.members, undefined, reader.former);
  const you: PersonActor = {
    kind: ACTOR_KIND.PERSON,
    userId: reader.id ?? "",
    name: reader.name ?? "",
    you: true,
  };
  return reader.pictureUrl === undefined ? you : { ...you, pictureUrl: reader.pictureUrl };
}

export function revisionAuthorOf(
  line: Pick<DescriptionRevisionLine, "lastEdit" | "agentId">,
  reader: HistoryReader,
  agents: readonly Pick<AgentSummary, "id" | "model">[],
): Actor {
  const { lastEdit } = line;
  switch (lastEdit.actor) {
    case DESCRIPTION_ACTOR.DEVELOPER:
      return personOf(lastEdit.by, reader);
    case DESCRIPTION_ACTOR.NOTETAKER:
      return APP_ACTOR;
    case DESCRIPTION_ACTOR.AGENT: {
      const agent = agents.find((each) => each.id === line.agentId);
      return {
        kind: ACTOR_KIND.AGENT,
        name: lastEdit.label ?? TAB_WORDS.AGENT,
        provider: agent === undefined ? undefined : providerOf(agent.model),
        state: ACTOR_STATE.REST,
      };
    }
    case DESCRIPTION_ACTOR.EARLIER:
      return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.EARLIER };
  }
}

export function revisionSummary(line: DescriptionRevisionLine): string {
  if (line.restoredFrom !== undefined) {
    return `Restored the version from ${dayAndTimeText(line.restoredFrom.at)}`;
  }
  if (line.lastEdit.actor === DESCRIPTION_ACTOR.EARLIER)
    return "The description before its history began";
  return line.changes === 1 ? "1 change" : `${line.changes} changes`;
}

export function revisionOfSave(
  revisions: readonly DescriptionRevisionLine[],
  at: number,
  complete: boolean,
): number | undefined {
  const before = revisions.findIndex((line) => line.lastEdit.at < at);
  if (before === -1) return complete ? revisions.at(-1)?.seq : undefined;
  return (revisions[before - 1] ?? revisions[before])?.seq;
}

const LONE_SPACE = /^[^\S\n]+$/u;

const BLOCK_OPENING = /^[^\S\n]*(?:[-*+]\s|\d{1,9}[.)]\s|#{1,6}\s|>|\|)/u;

const LIST_OPENING = /^[^\S\n]*(?:[-*+]|\d{1,9}[.)])\s/u;

function betweenStruckAndWritten(struck: string, written: string): string {
  if (struck.endsWith("\n") || written.startsWith("\n")) return "";
  const blocks = BLOCK_OPENING.test(struck) || BLOCK_OPENING.test(written) || struck.includes("\n");
  if (!blocks) return "";
  return LIST_OPENING.test(struck) && LIST_OPENING.test(written) ? "\n" : "\n\n";
}

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

function loneUnit(
  section: SectionWords,
  change: typeof VERSION_CHANGE.ADDED | typeof VERSION_CHANGE.REMOVED,
) {
  return { key: section.heading, words: section.text, change, marks: [] } satisfies VersionUnit;
}

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

export function versionDiff(
  base: DescriptionDocument | null,
  shown: DescriptionDocument,
): VersionDiff {
  const sectionsOf = (document: DescriptionDocument) => descriptionSections(document.body);
  const units =
    base === null
      ? sectionsOf(shown).map((section) => pairedUnit(section.text, section))
      : unitsAgainst(sectionsOf(base), sectionsOf(shown));
  const changed = units.some((unit) => unit.change !== VERSION_CHANGE.SAME);
  return { units, changed };
}

export interface ChangedSection {
  readonly unit: number;
  readonly heading: string;
  readonly change: Exclude<VersionChange, typeof VERSION_CHANGE.SAME>;
}

export function changedSections(diff: VersionDiff, first: boolean): readonly ChangedSection[] {
  return diff.units.flatMap((unit, at): ChangedSection[] => {
    const change = first ? VERSION_CHANGE.ADDED : unit.change;
    if (change === VERSION_CHANGE.SAME) return [];
    return [{ unit: at, heading: unit.key, change }];
  });
}

export function opensSections(line: DescriptionRevisionLine): boolean {
  return (
    line.changes > 1 &&
    line.restoredFrom === undefined &&
    line.lastEdit.actor !== DESCRIPTION_ACTOR.EARLIER
  );
}

export function sectionName(heading: string): string {
  return heading === "" ? "Opening" : heading;
}

export const REVISION_SOURCE = {
  AGENT: "agent",
} as const;

export type RevisionSource = {
  readonly kind: typeof REVISION_SOURCE.AGENT;
  readonly agentId: string;
};

export function revisionSource(
  line: Pick<DescriptionRevisionLine, "lastEdit" | "agentId">,
): RevisionSource | undefined {
  const { lastEdit } = line;
  if (lastEdit.actor === DESCRIPTION_ACTOR.AGENT && line.agentId !== undefined) {
    return { kind: REVISION_SOURCE.AGENT, agentId: line.agentId };
  }
  return undefined;
}

export function sourceLabel(_source: RevisionSource, author: Actor): string {
  return `Open ${actorName(author)}`;
}
