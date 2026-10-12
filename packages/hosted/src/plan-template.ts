import {
  EXCESS_KEYS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { openFenceAt, planSections } from "./plan-document.js";
import {
  PLAN_BOUNDS,
  PLAN_FIELD,
  PLAN_SECTION_BOUNDS,
  type PlanField,
  ROLLOUT_BASE,
  ROLLOUT_BOUNDS,
  type Rollout,
  type RolloutItem,
  rolloutItemSchema,
} from "./plan-wire.js";

/**
 * plan-template.ts -- the default template's sections and what each asks, the notes Luke takes into a plan's text, and the agents' journal of them.
 *
 * A plan is one Markdown text started from its account's own template
 * (`plan-document.ts`, `docs/PLANNING.md`). The default template is the
 * design doc two engineering teammates would write after talking a task
 * through: why it matters, what done looks like, how they will build it and
 * what they weighed against it, the hard parts, what they leave out, how the
 * work lands, and how they will know it works. Each section is a question a
 * good teammate asks, so the sections are what the planning model asks
 * about, and each is described once here: its heading, what it holds
 * (`PLAN_FIELD_PURPOSE`), and when it is good enough for a coding agent to
 * build from (`PLAN_FIELD_BAR`). The sections keep the keys the fixed
 * template once named its fields by (`PLAN_FIELD`), which is also what a note
 * an older agent takes names.
 *
 * Luke changes the text only by taking notes: a point added under a heading,
 * a phrase corrected, or a line struck. Each note lands in one place and
 * touches nothing else, so a plan is written the way a person takes notes on
 * a call, and a draft drawn while the notes stream differs from the one
 * before only where the newest note lands (`textNotesInProgress`). A note
 * naming a phrase the text does not hold is passed over rather than guessed
 * into another. A note's words are contained where they land: a line that
 * would open a heading or an HTML block is escaped, and a code fence left
 * open is closed, so no note can open a section of its own or swallow the
 * ones after it. The schema guarantees shape only; whether a note is
 * understood or agreed is the model's judgment.
 */

/** The default template's headings, in the words the developer reads. */
export const PLAN_HEADING = {
  CONTEXT: "Context",
  GOAL: "Goal",
  APPROACH: "Approach",
  INTERFACES: "Interfaces",
  ALTERNATIVES: "Alternatives",
  HARD_PARTS: "Hard parts",
  NOT_DOING: "Not doing",
  PLAN_OF_ATTACK: "Plan of attack",
  TESTING: "Testing",
  OPEN_QUESTIONS: "Open questions",
  ASSUMPTIONS: "Assumptions",
  ROLLOUT: "Rollout",
} as const;

/** What stands in the rollout's place while it holds nothing; the only rendering of its empty state. */
export const PLAN_EMPTY_TEXT = {
  NO_ROLLOUT: "_No rollout yet_",
} as const;

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** A code fence's opening or closing line: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/**
 * A line that would open an ATX heading, behind any blockquote or list
 * markers; the first group is everything before the hashes.
 */
const HEADING_LINE = /^( {0,3}(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*)(?=#{1,6}(?:[ \t]|$))/u;

/** A line that would underline the paragraph above it into a setext heading. */
const SETEXT_LINE = /^( {0,3}(?:>[ \t]*)*)(?=(?:=+|-+)[ \t]*$)/u;

/** A line that would open an HTML block, which the panel draws as nothing and which runs past its field. */
const HTML_LINE = /^( {0,3})(?=<)/u;

/** The one fence a field has open, which its closing line must match. */
interface OpenFence {
  readonly marker: string;
}

/** Whether a line opens a fence, and with which marker; a backtick fence's info string may hold no backtick. */
function fenceOpened(line: string): OpenFence | undefined {
  const match = FENCE_LINE.exec(line);
  const marker = match?.[1];
  if (marker === undefined) return undefined;
  if (marker.startsWith("`") && (match?.[2] ?? "").includes("`")) return undefined;
  return { marker };
}

/** Whether a line closes the fence standing: the same character, at least as long, and nothing after it. */
function fenceCloses(line: string, fence: OpenFence): boolean {
  const match = FENCE_LINE.exec(line);
  const marker = match?.[1];
  if (marker === undefined) return false;
  const sameCharacter = marker[0] === fence.marker[0];
  return sameCharacter && marker.length >= fence.marker.length && (match?.[2] ?? "").trim() === "";
}

/** One line outside a fence, with a backslash before whatever would open a heading or an HTML block. */
function escapedLine(line: string, afterText: boolean): string {
  const heading = HEADING_LINE.exec(line) ?? (afterText ? SETEXT_LINE.exec(line) : null);
  const opener = heading ?? HTML_LINE.exec(line);
  if (opener === null) return line;
  const at = opener[1]?.length ?? 0;
  return `${line.slice(0, at)}\\${line.slice(at)}`;
}

/**
 * Field text as Markdown that stays inside its field. Note that we leave a
 * fence's own lines as written, because a `#` inside code is code, and that
 * we close a fence the text left open, because an open fence would turn
 * every heading after it into code.
 */
function contained(text: string): string {
  const lines: string[] = [];
  let fence: OpenFence | undefined;
  let afterText = false;
  for (const line of text.replace(/\r\n?/gu, "\n").split("\n")) {
    if (fence !== undefined) {
      if (fenceCloses(line, fence)) fence = undefined;
      lines.push(line);
      afterText = false;
      continue;
    }
    fence = fenceOpened(line);
    lines.push(fence === undefined ? escapedLine(line, afterText) : line);
    afterText = fence === undefined && line.trim().length > 0;
  }
  if (fence !== undefined) lines.push(fence.marker);
  return lines.join("\n");
}

/** Text a heading carries on its one line. */
/** One list item, its later lines indented under the marker so a multi-line entry stays one item. */
function listItem(marker: string, text: string): string {
  const [first, ...rest] = contained(text).split("\n");
  const indent = " ".repeat(marker.length);
  const continued = rest.map((line) => (line.length === 0 ? line : `${indent}${line}`));
  return [`${marker}${first ?? ""}`, ...continued].join("\n");
}

/** The words that open a rollout item's last paragraph where its acceptance is said. */
const ROLLOUT_DONE_WHEN = "Done when: ";

/** A rollout item's base as its line names it: main, or the earlier pull request's number in the list. */
function rolloutBaseText(base: RolloutItem["base"]): string {
  return base === ROLLOUT_BASE.MAIN ? base : `#${base}`;
}

/**
 * One pull request of the rollout as a numbered item: its title and base on
 * the first line, its scope under it, and what it is done when, where said.
 */
function rolloutItemBlock(item: RolloutItem, position: number): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const head = `**${title}** · base: ${rolloutBaseText(item.base)}`;
  const done = item.acceptance === null ? [] : [`${ROLLOUT_DONE_WHEN}${item.acceptance}`];
  return listItem(`${position}. `, [head, item.scope, ...done].join("\n\n"));
}

/**
 * The rollout as the section drawn after a plan's text: its heading over one
 * numbered item per pull request, or over "No rollout yet" while it is empty.
 * Note that this is drawn and never stored, because the rollout stands beside
 * the text rather than in it, so an edit of the text can neither write nor
 * lose it.
 */
export function rolloutSection(rollout: Rollout): string {
  const items = rollout.map((item, at) => rolloutItemBlock(item, at + 1)).join("\n");
  return `## ${PLAN_HEADING.ROLLOUT}\n\n${items.length === 0 ? PLAN_EMPTY_TEXT.NO_ROLLOUT : items}`;
}

/** What the rollout holds, in the words the planning model is shown beside each section's. */
export const ROLLOUT_PURPOSE =
  "The pull requests the work lands as, in order, each on main or on an earlier one.";

/** When the rollout is good enough to hand out, held to the same bar as each section's. */
export const ROLLOUT_BAR =
  "Every pull request lands green alone, is one concern a reviewer reads in minutes, bases on " +
  "the lowest pull request it cannot build without, and carries its own tests; a rollout of " +
  "one pull request has been asked once whether it splits.";

/** The heading each section stands under in the default template, so a prompt names a section as the developer reads it. */
export const PLAN_FIELD_HEADING = {
  context: PLAN_HEADING.CONTEXT,
  goal: PLAN_HEADING.GOAL,
  approach: PLAN_HEADING.APPROACH,
  interfaces: PLAN_HEADING.INTERFACES,
  alternatives: PLAN_HEADING.ALTERNATIVES,
  hardParts: PLAN_HEADING.HARD_PARTS,
  notDoing: PLAN_HEADING.NOT_DOING,
  planOfAttack: PLAN_HEADING.PLAN_OF_ATTACK,
  testing: PLAN_HEADING.TESTING,
  openQuestions: PLAN_HEADING.OPEN_QUESTIONS,
  assumptions: PLAN_HEADING.ASSUMPTIONS,
} as const satisfies Record<PlanField, string>;

/**
 * What each field holds and the form it is written in. Note that this is the
 * one statement of a section's meaning, because the planning model asks from
 * it and the notetaker writes to it, and two copies would drift into Luke
 * asking for one thing and the notes filing another.
 */
export const PLAN_FIELD_PURPOSE = {
  context:
    "Why this work exists: what happens today, who it affects and how often, and what " +
    "prompted it now. Current behavior is stated as the code or the developer says it is, " +
    "never guessed.",
  goal:
    "What is true once the work ships, one outcome per bullet, each something a user or a " +
    "test could observe. No implementation detail.",
  approach:
    "The design in plain words: the main pieces and how they fit together, where each lives " +
    "by repository-relative path, the existing code or pattern each follows, and each " +
    "design decision with its reason.",
  interfaces:
    "Every type, schema, table, route, event, tool, or function signature the change adds " +
    "or changes, written as code in fenced blocks under the path of the file it lives in. " +
    'Shapes and signatures only, never function bodies. "None" with the reason when ' +
    "nothing at a module boundary changes.",
  alternatives:
    "Each other approach that was weighed: what it was, and the concrete reason it lost.",
  hardParts:
    "Each tricky case as one bullet: the situation, then exactly what the change does in it. " +
    "Edge cases, failure, cancellation, retry, concurrency, permissions, privacy, and " +
    "performance where they apply, and each risk with how it is handled.",
  notDoing:
    "What is out of scope, one bullet each with why, including anything a capable agent " +
    "might otherwise build unasked.",
  planOfAttack:
    "The steps the work lands in, in order, each one testable on its own, and why the order " +
    "matters. Data migration, backfill, and rollout where they apply.",
  testing:
    'The cases that prove the change, one bullet each written as "When <situation>, then ' +
    '<exact observable result>", then the end-to-end check a person or a script runs to ' +
    "prove it works, with its command where there is one.",
  openQuestions:
    "Each unresolved question, contradiction, or fact no source could settle, worded as a " +
    "question, one per note.",
  assumptions:
    "What the plan assumes without the developer having said it, Luke's suggestions not yet " +
    "agreed among them, one per note.",
} as const satisfies Record<PlanField, string>;

/**
 * When each section is good enough for a coding agent to build from without
 * coming back with a question. The planning model holds the plan to these
 * before it calls the plan complete; the notetaker is never told them,
 * because it records what was said rather than judging it.
 */
export const PLAN_FIELD_BAR = {
  context: "Someone new to the code could explain why the work matters.",
  goal: "Every outcome can be checked true or false.",
  approach:
    "Every piece names the path it lives in and the code it follows, and no step says only " +
    '"update" or "handle".',
  interfaces:
    "Every new or changed boundary is written as code under its file, or the section says " +
    '"None" and why.',
  alternatives:
    "Optional. Every alternative the developer raised or Luke suggested has the reason it lost.",
  hardParts: "Every case says exactly what the change does, not only that it is hard.",
  notDoing: "Anything a capable agent might add unasked is listed.",
  planOfAttack: "Optional. Needed when the order of the steps matters or stored data moves.",
  testing:
    "Every goal and every hard part has at least one When/then case with an exact result, " +
    "and there is an end-to-end check.",
  openQuestions: "Nothing left in it would change what gets built.",
  assumptions: "Every choice Luke made for the developer is listed.",
} as const satisfies Record<PlanField, string>;

/** The kinds of note the notetaker takes. */
export const NOTE_KIND = {
  ADD: "add",
  REPLACE: "replace",
  REMOVE: "remove",
} as const;

/** The most notes one answer may take. */
const MAX_NOTES = 40;

/** The longest phrase a note may name to correct or strike. */
const MAX_FIND_CHARS = 500;

const SECTION = describeWire(
  trimmedText(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS),
  "The heading the point goes under, copied exactly from the plan's text, without its #s. " +
    "A heading the text does not hold opens a new section at its end.",
);

const FIND = describeWire(
  trimmedText(MAX_FIND_CHARS),
  "A phrase copied exactly from the plan's saved text, long enough to name one place, " +
    "and touching no heading.",
);

const addNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD),
  section: SECTION,
  text: describeWire(
    trimmedText(PLAN_BOUNDS.MAX_BODY_CHARS),
    "The new point, added at the end of the section: Markdown, a bullet where the section " +
      "is a list.",
  ),
});

const replaceNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REPLACE),
  find: FIND,
  text: describeWire(trimmedText(PLAN_BOUNDS.MAX_BODY_CHARS), "What the phrase becomes."),
});

const removeNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REMOVE),
  find: describeWire(
    trimmedText(MAX_FIND_CHARS),
    "A phrase copied exactly from the line to strike, touching no heading.",
  ),
});

/** The rollout as a note names it: beside the plan's text, its items pull requests rather than words. */
export const ROLLOUT_NOTE_FIELD = "rollout";

const ROLLOUT_FIELD = describeWire(
  EffectSchema.Literal(ROLLOUT_NOTE_FIELD),
  "The rollout: the pull requests the work lands as, in order.",
);

const ROLLOUT_FIND = describeWire(
  trimmedText(MAX_FIND_CHARS),
  "A phrase copied exactly from the title of the one pull request the note changes.",
);

/** A rollout note's pull request, described as the note uses it and then as what each of its keys holds. */
function rolloutItem(use: string) {
  return describeWire(
    rolloutItemSchema,
    `${use} Its title; its scope, what it changes; its base, main or the position counted ` +
      "from one of the earlier pull request it cannot build without; and acceptance, what is " +
      "true once it lands, or null while unsaid.",
  );
}

const addRolloutNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD),
  field: ROLLOUT_FIELD,
  item: rolloutItem("The new pull request, added after the last."),
});

const replaceRolloutNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REPLACE),
  field: ROLLOUT_FIELD,
  find: ROLLOUT_FIND,
  item: rolloutItem("The pull request as it now stands, in the same position."),
});

const removeRolloutNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REMOVE),
  field: ROLLOUT_FIELD,
  find: ROLLOUT_FIND,
});

const headingNoteSchema = EffectSchema.Union([addNoteSchema, replaceNoteSchema, removeNoteSchema]);

/**
 * A note as the models answer it: a pull request of the rollout, or a point
 * under a heading of the text. Note that the rollout's shapes are tried
 * first, because a rollout strike also reads as a strike of the text once its
 * field is dropped, and would cut the phrase from the plan's words.
 */
const planNoteSchema = EffectSchema.Union([
  addRolloutNoteSchema,
  replaceRolloutNoteSchema,
  removeRolloutNoteSchema,
  addNoteSchema,
  replaceNoteSchema,
  removeNoteSchema,
]);

/**
 * A correction or a strike an agent started before heading notes aimed at
 * one field, taken within the section under that field's heading alone, as
 * the fixed template took it within the field.
 */
type ScopedNote = Exclude<
  typeof headingNoteSchema.Type,
  { readonly kind: typeof NOTE_KIND.ADD }
> & {
  readonly within: string;
};

/** One note: a point added under a heading, a phrase corrected, or a line struck; under the rollout, a pull request added, restated, or struck. */
export type PlanNote = typeof planNoteSchema.Type | ScopedNote;

/** A note taken under the rollout, whose items are pull requests named by their titles. */
type RolloutNote = Extract<PlanNote, { readonly field: typeof ROLLOUT_NOTE_FIELD }>;

/** A note taken in the plan's text, under a heading or on a phrase of it. */
type TextNote = Exclude<PlanNote, RolloutNote>;

function isRolloutNote(note: PlanNote): note is RolloutNote {
  return "field" in note && note.field === ROLLOUT_NOTE_FIELD;
}

function isTextNote(note: PlanNote): note is TextNote {
  return !isRolloutNote(note);
}

/** What the notetaker answers each run with: the notes the latest lines call for, in the order taken. */
export const planNotesSchema = EffectSchema.Struct({
  notes: describeWire(
    EffectSchema.Array(planNoteSchema).check(EffectSchema.isMaxLength(MAX_NOTES)),
    "The notes the latest lines call for, in order; empty when nothing new was said.",
  ),
});

/**
 * A note as the fixed template's notetaker took it, naming the field it was
 * taken under: an addition went after what the field held, a list's item
 * without its marker where the field was a list, and a correction or a strike
 * named a phrase within the field. A coding agent started before notes named
 * headings still takes them so, and the journal keeps the ones it took, so
 * they are read still, as the note under that field's heading, a correction
 * or a strike kept within its section (`noteOf`).
 * TODO: delete once no journal row holds one and no agent started before
 * heading notes can still be running.
 */
const NOTE_FIELD = EffectSchema.Literals(Object.values(PLAN_FIELD));

const fieldAddNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD),
  field: NOTE_FIELD,
  text: trimmedText(PLAN_BOUNDS.MAX_BODY_CHARS),
});

const fieldReplaceNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REPLACE),
  field: NOTE_FIELD,
  find: trimmedText(MAX_FIND_CHARS),
  text: trimmedText(PLAN_BOUNDS.MAX_BODY_CHARS),
});

const fieldRemoveNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REMOVE),
  field: NOTE_FIELD,
  find: trimmedText(MAX_FIND_CHARS),
});

/**
 * A note as it may be read: under the rollout, as the fixed template's
 * notetaker took it, or under a heading. Note that the rollout's shapes are
 * tried first, because a rollout strike also reads as a strike of the text
 * with its field dropped, and the field shapes before the heading ones,
 * because a correction naming a field also reads under the heading shape
 * with the field dropped, which would aim it at the whole text.
 */
const readNoteSchema = EffectSchema.Union([
  addRolloutNoteSchema,
  replaceRolloutNoteSchema,
  removeRolloutNoteSchema,
  fieldAddNoteSchema,
  fieldReplaceNoteSchema,
  fieldRemoveNoteSchema,
  addNoteSchema,
  replaceNoteSchema,
  removeNoteSchema,
]);

/** A note as it may be read, before it is taken as a note under a heading. */
export type PlanReadNote = typeof readNoteSchema.Type;

/** A note read in either shape as the note under a heading it stands for. */
export function noteOf(note: PlanReadNote): PlanNote {
  if (!("field" in note) || note.field === ROLLOUT_NOTE_FIELD) return note;
  const heading = PLAN_FIELD_HEADING[note.field];
  switch (note.kind) {
    case NOTE_KIND.ADD: {
      // A list's item is drawn as the fixed template drew it, its later lines indented under its marker.
      const text = isTextField(note.field) ? note.text : listItem("- ", itemText(note.text));
      return { kind: NOTE_KIND.ADD, section: heading, text };
    }
    case NOTE_KIND.REPLACE:
      return { kind: NOTE_KIND.REPLACE, find: note.find, text: note.text, within: heading };
    case NOTE_KIND.REMOVE:
      return { kind: NOTE_KIND.REMOVE, find: note.find, within: heading };
  }
}

/** Where a correction or a strike may look for its phrase: the whole text, or the one section an older agent aimed it at. */
function searchedSpan(text: string, note: TextNote): Span | undefined {
  if (!("within" in note)) return { from: 0, to: text.length };
  const section = planSections(text).find((each) => each.heading === note.within);
  return section === undefined ? undefined : { from: section.from, to: section.to };
}

/** The most saves by coding agents a plan keeps word of; older ones fall off the front. */
export const PLAN_AGENT_EDITS_KEPT = 50;

/**
 * One save a coding agent made on the plan: which agent, when, and the notes
 * as they were taken. The agent is named by its id alone, so whoever reads
 * the journal names it by what its row says now.
 */
export const planAgentEditSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  /** Epoch milliseconds of the save. */
  at: EffectSchema.Number,
  notes: EffectSchema.Array(readNoteSchema),
});

export type PlanAgentEdit = typeof planAgentEditSchema.Type;

/** The journal with one more save on its end, the oldest let go past the bound. */
export function withAgentEdit(
  journal: readonly PlanAgentEdit[],
  edit: PlanAgentEdit,
): readonly PlanAgentEdit[] {
  return [...journal, edit].slice(-PLAN_AGENT_EDITS_KEPT);
}

/** A line that opens a Markdown list item. */
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/u;

/** The list markers a list item's text opens with, which the formatter draws itself. */
const LEADING_LIST_MARKERS = /^(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)+/u;

/** A trailing line still being written that holds nothing but Markdown markers, whose escaping would change as it grows. */
const MARKER_ONLY_LINE = /^[\s#>*+=`~<\-\d.)]+$/u;

/**
 * A note's text as one item of a list. Note that we drop the list markers it
 * opens with, because the formatter draws each item's own marker and a second
 * would nest the item one bullet deeper.
 */
function itemText(text: string): string {
  return text.replace(LEADING_LIST_MARKERS, "").trim();
}

/** Whether a field of the fixed template held one Markdown answer, as against a list of items. */
function isTextField(field: PlanField): boolean {
  return field !== PLAN_FIELD.OPEN_QUESTIONS && field !== PLAN_FIELD.ASSUMPTIONS;
}

function escapedPattern(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** A stretch of a text, from one offset to another. */
interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * Every place a phrase stands in a text: exactly, or failing that with any
 * run of whitespace standing for any other, since the model copies a phrase
 * that wrapped as one that did not.
 */
function spansOf(text: string, find: string): readonly Span[] {
  const exact: Span[] = [];
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) {
    exact.push({ from: at, to: at + find.length });
  }
  if (exact.length > 0) return exact;
  const words = find.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return [];
  const pattern = new RegExp(words.map(escapedPattern).join("\\s+"), "gu");
  return [...text.matchAll(pattern)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }));
}

/**
 * The one place a phrase stands in a text, or nothing where it stands
 * nowhere or more than once. Note that a phrase standing twice is never read
 * as its first place, because a correction landing on the wrong line is the
 * edit a note must never make.
 */
function located(text: string, find: string): Span | undefined {
  const spans = spansOf(text, find);
  return spans.length === 1 ? spans[0] : undefined;
}

/** Text added after a field's answer: on the next line within a list, and as a new paragraph otherwise. */
function appended(current: string | null, text: string): string {
  if (current === null) return text;
  const lastLine = current.slice(current.lastIndexOf("\n") + 1);
  const joiner = LIST_ITEM_LINE.test(lastLine) && LIST_ITEM_LINE.test(text) ? "\n" : "\n\n";
  return `${current}${joiner}${text}`;
}

/**
 * Words with any fence still open at their end closed on a line of its own,
 * so a point written after them is not taken into the code the fence holds.
 */
function fenceClosed(words: string): string {
  const open = openFenceAt(words, words.length + 1);
  return open === undefined ? words : `${words}\n${open}`;
}

/**
 * The text with a point added at the end of the first section under the
 * note's heading, or, where the text has no such section, a new one at the
 * end of the text holding it; a fence the section or the text leaves open is
 * closed before it.
 */
function addedToText(
  text: string,
  note: Extract<TextNote, { kind: typeof NOTE_KIND.ADD }>,
): string {
  const heading = note.section;
  const added = contained(note.text);
  const section = planSections(text).find((each) => each.heading === heading);
  if (section === undefined) {
    const head = fenceClosed(text.trimEnd());
    return `${head.length === 0 ? "" : `${head}\n\n`}## ${heading}\n\n${added}\n`;
  }
  const words = fenceClosed(section.text);
  const lines = words.split("\n");
  const under = lines.length > 1 ? appended(words, added) : `${words}\n\n${added}`;
  return text.slice(0, section.from) + under + text.slice(section.to);
}

/** Whether a span touches a heading line of the text, which a note may never rewrite or strike. */
function touchesHeading(text: string, at: Span): boolean {
  return planSections(text).some((section) => {
    if (section.heading === "" && !text.startsWith("#", section.from)) return false;
    const lineEnd = text.indexOf("\n", section.from);
    const headingTo = lineEnd === -1 ? text.length : lineEnd;
    return at.from <= headingTo && at.to >= section.from;
  });
}

/** The text with the lines a span touches struck out, and the blank line it leaves doubled taken back. */
function struckFromText(text: string, at: Span): string {
  const start = text.lastIndexOf("\n", at.from - 1) + 1;
  const newline = text.indexOf("\n", at.to);
  const end = newline === -1 ? text.length : newline + 1;
  const head = text.slice(0, start);
  const tail = text.slice(end);
  if (tail.trim().length === 0) return head.replace(/\n+$/u, "\n");
  return head.endsWith("\n\n") || head.length === 0
    ? head + tail.replace(/^\n+/u, "")
    : head + tail;
}

/**
 * A document's text with one note taken, or nothing where the note cannot
 * be: an addition at the end of the first section under its heading, or as
 * a new section at the end of the text where it has none; a correction
 * or a strike names a phrase that must stand exactly once in the whole text
 * and touch no heading, since the headings are the developer's and a note
 * writes under them.
 */
function applyNoteToText(text: string, note: TextNote): string | undefined {
  if (note.kind === NOTE_KIND.ADD) return addedToText(text, note);
  const searched = searchedSpan(text, note);
  if (searched === undefined) return undefined;
  const inside = located(text.slice(searched.from, searched.to), note.find);
  const at =
    inside === undefined
      ? undefined
      : { from: searched.from + inside.from, to: searched.from + inside.to };
  if (at === undefined || touchesHeading(text, at)) return undefined;
  if (note.kind === NOTE_KIND.REMOVE) return struckFromText(text, at);
  // A correction inside a fence is code, written as given rather than contained as prose.
  const words = openFenceAt(text, at.from) === undefined ? contained(note.text) : note.text;
  return text.slice(0, at.from) + words + text.slice(at.to);
}

/** Notes taken over a document's text: the text after, and the notes that could not be taken. */
export interface TextNotesTaken {
  readonly text: string;
  readonly missed: readonly PlanNote[];
}

/**
 * Every note on a document's text taken in order, and the notes that could
 * not be. Note that a rollout note is passed over here, neither taken nor
 * missed, because the rollout stands beside the text and is never written
 * into it (`applyRolloutNotes`).
 */
export function applyNotesToText(text: string, notes: readonly PlanNote[]): TextNotesTaken {
  let taken = text;
  const missed: PlanNote[] = [];
  for (const note of notes.filter(isTextNote)) {
    const next = applyNoteToText(taken, note);
    if (next === undefined) missed.push(note);
    else taken = next;
  }
  return { text: taken, missed };
}

/** Which one item of a list holds a phrase, where exactly one place in the whole list does; -1 otherwise. */
function soleHolder<Item>(
  items: readonly Item[],
  textsOf: (item: Item) => readonly string[],
  find: string,
): number {
  const counts = items.map((item) =>
    textsOf(item).reduce((total, text) => total + spansOf(text, find).length, 0),
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  return total === 1 ? counts.indexOf(1) : -1;
}

/** Whether a rollout is within its bound and every pull request bases on main or on one before it. */
function rolloutHolds(rollout: Rollout): boolean {
  return (
    rollout.length <= ROLLOUT_BOUNDS.MAX_PULL_REQUESTS &&
    rollout.every((item, at) => item.base === ROLLOUT_BASE.MAIN || item.base <= at)
  );
}

/**
 * The rollout with a pull request struck, each later one's base counted down
 * past it, or nothing where another pull request bases on it. Note that a
 * pull request still built on is never struck, because re-basing its
 * dependents is a decision the note does not make.
 */
function rolloutStruck(rollout: Rollout, index: number): Rollout | undefined {
  const position = index + 1;
  if (rollout.some((item) => item.base === position)) return undefined;
  return rollout
    .filter((_, at) => at !== index)
    .map((item) =>
      item.base !== ROLLOUT_BASE.MAIN && item.base > position
        ? { ...item, base: item.base - 1 }
        : item,
    );
}

/** The rollout with a note taken as it says, or nothing where the title it names is not one pull request's. */
function rolloutChanged(rollout: Rollout, note: RolloutNote): Rollout | undefined {
  if (note.kind === NOTE_KIND.ADD) return [...rollout, note.item];
  const index = soleHolder(rollout, (item) => [item.title], note.find);
  if (index === -1) return undefined;
  if (note.kind === NOTE_KIND.REMOVE) return rolloutStruck(rollout, index);
  return rollout.map((standing, at) => (at === index ? note.item : standing));
}

/**
 * The rollout with a note taken, or nothing where it cannot be: a title it
 * names that no one pull request holds, a struck pull request another bases
 * on, or a rollout left with a base at or past its own position or grown
 * past its bound.
 */
function rolloutNoted(rollout: Rollout, note: RolloutNote): Rollout | undefined {
  const noted = rolloutChanged(rollout, note);
  return noted !== undefined && rolloutHolds(noted) ? noted : undefined;
}

/** Rollout notes taken over a plan's rollout: the rollout after, and the notes that could not be taken. */
export interface RolloutNotesTaken {
  readonly rollout: Rollout;
  readonly missed: readonly PlanNote[];
}

/**
 * Every rollout note taken over a plan's rollout in order, and the notes that
 * could not be. A note on the text is passed over here, neither taken nor
 * missed (`applyNotesToText`).
 */
export function applyRolloutNotes(rollout: Rollout, notes: readonly PlanNote[]): RolloutNotesTaken {
  let taken = rollout;
  const missed: PlanNote[] = [];
  for (const note of notes.filter(isRolloutNote)) {
    const next = rolloutNoted(taken, note);
    if (next === undefined) missed.push(note);
    else taken = next;
  }
  return { rollout: taken, missed };
}

const readNote = readEither(readNoteSchema, { excess: EXCESS_KEYS.DROP });

/** Text still being written, cut back to its last line that cannot change how it is escaped. */
function settledText(text: string): string {
  const lastBreak = text.lastIndexOf("\n");
  const lastLine = text.slice(lastBreak + 1);
  return MARKER_ONLY_LINE.test(lastLine) ? text.slice(0, Math.max(0, lastBreak)) : text;
}

/** The note still being written, read as an addition whose text so far can be shown, or nothing. */
function growingAddition(value: UnparsedWireValue): PlanNote | undefined {
  if (!isRecord(value) || value.kind !== NOTE_KIND.ADD || !isWireString(value.text)) {
    return undefined;
  }
  const text = settledText(value.text).trim();
  if (text.length === 0) return undefined;
  const read = readNote(unparsedWire({ ...value, text }));
  if (Result.isFailure(read)) return undefined;
  const note = noteOf(read.success);
  // A pull request is drawn only whole, so a rollout note never grows here.
  return isRolloutNote(note) ? undefined : note;
}

/** An answer's notes as read, and how many of its notes did not read. */
export interface NotesRead {
  readonly notes: readonly PlanNote[];
  readonly unread: number;
}

/**
 * The notes of an answer, each read on its own so a note that does not read
 * is passed over alone rather than costing the rest, and how many were; a
 * note in the fixed template's shape reads as the note under a heading it
 * stands for.
 */
export function readNotes(answer: UnparsedWireValue): NotesRead {
  const values = isRecord(answer) && Array.isArray(answer.notes) ? answer.notes : [];
  const notes = values.flatMap((value: UnparsedWireValue) => {
    const read = readNote(value);
    return Result.isSuccess(read) ? [noteOf(read.success)] : [];
  });
  return { notes: notes.slice(0, MAX_NOTES), unread: values.length - notes.length };
}

/**
 * A document's text as the notetaker's answer so far leaves it, for a draft
 * drawn while the answer streams. The answer arrives as the JSON emitted so
 * far, so every note before the last is whole, and each is taken in order;
 * one that does not read or cannot be taken is passed over alone. The last
 * note may be cut off partway, so it is drawn only when it adds a point, as
 * the text written so far, held back at a trailing line of nothing but
 * Markdown markers. Each draft therefore differs from the one before only
 * where the newest note lands.
 */
export function textNotesInProgress(text: string, partial: UnparsedWireValue): string {
  return applyNotesToText(text, notesSoFar(partial)).text;
}

/**
 * A plan's rollout as the notetaker's answer so far leaves it. Note that a
 * pull request is drawn only once its note is whole, because a title or a
 * base still being written would move under the developer's eyes.
 */
export function rolloutNotesInProgress(rollout: Rollout, partial: UnparsedWireValue): Rollout {
  return applyRolloutNotes(rollout, notesSoFar(partial)).rollout;
}

/** The notes an answer so far holds: every whole note that reads, then the last, while it adds a point, as written so far. */
function notesSoFar(partial: UnparsedWireValue): readonly PlanNote[] {
  const values = isRecord(partial) && Array.isArray(partial.notes) ? partial.notes : [];
  const { notes: whole } = readNotes(unparsedWire({ notes: values.slice(0, -1) }));
  const growing = growingAddition(values.at(-1));
  return growing === undefined ? whole : [...whole, growing];
}
