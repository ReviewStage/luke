import {
  EXCESS_KEYS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { PLAN_BOUNDS, type PlanAssumption } from "./plan-wire.js";

/**
 * plan-template.ts -- the one fixed template every feature plan is written in: the notes the notetaker takes, the fields they land in, and the canonical Markdown body those become.
 *
 * Every plan has the same sections in the same order (`docs/PLANNING.md`,
 * "The fixed template"). The service keeps the plan's fields as they stand,
 * and the notetaker changes them only by taking notes: a point added under a
 * field, a phrase corrected, or a line struck.
 * Each note lands in one place and touches nothing else, so a plan is written
 * the way a person takes notes on a call, and a draft drawn while the notes
 * stream differs from the one before only where the newest note lands
 * (`notesInProgress`). A note naming a phrase the field does not hold is
 * passed over rather than guessed into another. A core field reads
 * "Unanswered" while it holds nothing; an optional field is left out of the
 * body until it holds something. The fields are formatted here into the
 * document's Markdown `body`, and the document the window and the model read
 * stays `{ body, assumptions }` (`plan-wire.ts`). No code reads the body back
 * into fields.
 *
 * The template is the design doc two engineering teammates would write
 * after talking a task through: why it matters, what done looks like, how
 * they will build it and what they weighed against it, the hard parts, what
 * they leave out, how the work lands, and how they will know it works. Each
 * section is a question a good teammate asks, so the sections are what the
 * planning model asks about. The same document is the whole spec a coding
 * agent builds from, so the sections an agent needs exactly (the
 * interfaces, how each hard case behaves, and the test cases) each carry a
 * bar a plan must meet before it is done (`PLAN_FIELD_BAR`). The agent
 * explores the code itself, so the plan carries pointers into the code
 * rather than a description of it.
 *
 * The formatter owns every heading and its order. Field text is Markdown the
 * model wrote, contained where it stands: a line that would open a heading or
 * an HTML block is escaped, and a code fence left open is closed at the end of
 * its field, so no answer can impersonate a section or swallow the ones after
 * it. The schema guarantees shape only; whether a note is understood or
 * agreed is the model's judgment.
 */

/** Bounds on the fields and the notes; the formatted body is held to `PLAN_BOUNDS.MAX_BODY_CHARS` after formatting. */
const PLAN_TEMPLATE_BOUNDS = {
  /** One answer may be at most the whole body; the formatted total is what is held to the body bound. */
  MAX_ANSWER_CHARS: PLAN_BOUNDS.MAX_BODY_CHARS,
  /** The most open questions or assumptions. */
  MAX_ITEMS: 200,
} as const;

/** Every heading the formatter writes, in the words the developer reads. */
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
} as const;

/** What stands in a field's place while it holds nothing; each is the only rendering of its empty state. */
export const PLAN_EMPTY_TEXT = {
  UNANSWERED: "_Unanswered_",
  NO_QUESTIONS: "_No additional questions recorded_",
  NO_ASSUMPTIONS: "_None recorded_",
} as const;

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** An ordinary answer: null while unanswered, otherwise nonblank text. */
const ANSWER = EffectSchema.NullOr(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS));

/** Every section of the template, in its order: what the service keeps for a plan. */
export const planFieldsSchema = EffectSchema.Struct({
  context: ANSWER,
  goal: ANSWER,
  approach: ANSWER,
  interfaces: ANSWER,
  alternatives: ANSWER,
  hardParts: ANSWER,
  notDoing: ANSWER,
  planOfAttack: ANSWER,
  testing: ANSWER,
  openQuestions: EffectSchema.Array(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS)).check(
    EffectSchema.isMaxLength(PLAN_TEMPLATE_BOUNDS.MAX_ITEMS),
  ),
});

export type PlanFields = typeof planFieldsSchema.Type;

/** What the document's header names: the plan, the service's and never the model's. */
export interface PlanHeader {
  readonly name: string;
}

/** A plan's whole content as the notetaker writes it: the template's fields and the assumptions beside them. */
export interface PlanContent {
  readonly fields: PlanFields;
  readonly assumptions: readonly PlanAssumption[];
}

/** A new plan's fields: every answer unanswered and no questions. */
export const EMPTY_PLAN_FIELDS: PlanFields = {
  context: null,
  goal: null,
  approach: null,
  interfaces: null,
  alternatives: null,
  hardParts: null,
  notDoing: null,
  planOfAttack: null,
  testing: null,
  openQuestions: [],
};

/** A new plan's content: every answer unanswered, no questions, and no assumptions. */
export const EMPTY_PLAN_CONTENT: PlanContent = { fields: EMPTY_PLAN_FIELDS, assumptions: [] };

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
function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function answerBlock(value: string | null): string {
  return value === null ? PLAN_EMPTY_TEXT.UNANSWERED : contained(value);
}

function section(heading: string, blocks: readonly string[]): string {
  return [`## ${heading}`, ...blocks].join("\n\n");
}

/** One list item, its later lines indented under the marker so a multi-line entry stays one item. */
function listItem(marker: string, text: string): string {
  const [first, ...rest] = contained(text).split("\n");
  const indent = " ".repeat(marker.length);
  const continued = rest.map((line) => (line.length === 0 ? line : `${indent}${line}`));
  return [`${marker}${first ?? ""}`, ...continued].join("\n");
}

function headerBlock(header: PlanHeader): string {
  return `# ${oneLine(header.name)}`;
}

/** A core section: its heading over its answer, or over the unanswered mark while null. */
function coreSection(heading: string, value: string | null): string {
  return section(heading, [answerBlock(value)]);
}

/** An optional section: its heading and answer once it holds something, nothing while null. */
function optionalSection(heading: string, value: string | null): readonly string[] {
  return value === null ? [] : [section(heading, [contained(value)])];
}

/**
 * The canonical Markdown body of a plan: the header the service supplies,
 * then every section in the template's order, whatever order the fields'
 * keys arrived in. The assumptions are not part of the body; they are the
 * document's own list, drawn after it as the template's last section.
 */
export function planBody(header: PlanHeader, fields: PlanFields): string {
  const { openQuestions } = fields;
  const blocks = [
    headerBlock(header),
    coreSection(PLAN_HEADING.CONTEXT, fields.context),
    coreSection(PLAN_HEADING.GOAL, fields.goal),
    coreSection(PLAN_HEADING.APPROACH, fields.approach),
    coreSection(PLAN_HEADING.INTERFACES, fields.interfaces),
    ...optionalSection(PLAN_HEADING.ALTERNATIVES, fields.alternatives),
    coreSection(PLAN_HEADING.HARD_PARTS, fields.hardParts),
    coreSection(PLAN_HEADING.NOT_DOING, fields.notDoing),
    ...optionalSection(PLAN_HEADING.PLAN_OF_ATTACK, fields.planOfAttack),
    coreSection(PLAN_HEADING.TESTING, fields.testing),
    section(PLAN_HEADING.OPEN_QUESTIONS, [
      openQuestions.length === 0
        ? PLAN_EMPTY_TEXT.NO_QUESTIONS
        : openQuestions.map((question) => listItem("- ", question)).join("\n"),
    ]),
  ];
  return `${blocks.join("\n\n")}\n`;
}

/** Every field a note may be taken under, in the template's order. */
export const PLAN_FIELD = {
  CONTEXT: "context",
  GOAL: "goal",
  APPROACH: "approach",
  INTERFACES: "interfaces",
  ALTERNATIVES: "alternatives",
  HARD_PARTS: "hardParts",
  NOT_DOING: "notDoing",
  PLAN_OF_ATTACK: "planOfAttack",
  TESTING: "testing",
  OPEN_QUESTIONS: "openQuestions",
  ASSUMPTIONS: "assumptions",
} as const;

export type PlanField = (typeof PLAN_FIELD)[keyof typeof PLAN_FIELD];

/** Each field's heading in the body, so a prompt can name a section as the developer reads it. */
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

const NOTE_FIELD = describeWire(
  EffectSchema.Literals(Object.values(PLAN_FIELD)),
  "The field the note is taken under.",
);

const FIND = describeWire(
  trimmedText(MAX_FIND_CHARS),
  "A phrase copied exactly from the field's saved text, long enough to name one place.",
);

const addNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD),
  field: NOTE_FIELD,
  text: describeWire(
    trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS),
    "The new point, added after what the field holds: a Markdown bullet in a text field, " +
      "one item in a list.",
  ),
});

const replaceNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REPLACE),
  field: NOTE_FIELD,
  find: FIND,
  text: describeWire(
    trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS),
    "What the phrase becomes.",
  ),
});

const removeNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REMOVE),
  field: NOTE_FIELD,
  find: describeWire(
    trimmedText(MAX_FIND_CHARS),
    "A phrase copied exactly from the line or item to strike.",
  ),
});

const planNoteSchema = EffectSchema.Union([addNoteSchema, replaceNoteSchema, removeNoteSchema]);

/** One note: a point added, a phrase corrected, or a line struck. */
export type PlanNote = typeof planNoteSchema.Type;

/** What the notetaker answers each run with: the notes the latest lines call for, in the order taken. */
export const planNotesSchema = EffectSchema.Struct({
  notes: describeWire(
    EffectSchema.Array(planNoteSchema).check(EffectSchema.isMaxLength(MAX_NOTES)),
    "The notes the latest lines call for, in order; empty when nothing new was said.",
  ),
});

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
  notes: EffectSchema.Array(planNoteSchema),
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

/** What one field of a plan's content holds: an answer or a list. */
type PlanFieldValue = string | null | PlanFields["openQuestions"] | readonly PlanAssumption[];

/** What one field of a plan's content holds, whatever its kind. */
function planFieldValue(content: PlanContent, field: PlanField): PlanFieldValue {
  if (field === PLAN_FIELD.ASSUMPTIONS) return content.assumptions;
  return content.fields[field];
}

/**
 * The fields whose words differ from one content to another. Note that the
 * words are compared rather than the objects, because a note taken into a
 * field builds the field anew even where its words come out the same.
 */
export function changedFields(before: PlanContent, after: PlanContent): readonly PlanField[] {
  return Object.values(PLAN_FIELD).filter(
    (field) =>
      JSON.stringify(planFieldValue(before, field)) !==
      JSON.stringify(planFieldValue(after, field)),
  );
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

/** A field's text with nothing left in it read as unanswered. */
function answered(text: string): string | null {
  const trimmed = text.replace(/\n{3,}/gu, "\n\n").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Text added after a field's answer: on the next line within a list, and as a new paragraph otherwise. */
function appended(current: string | null, text: string): string {
  if (current === null) return text;
  const lastLine = current.slice(current.lastIndexOf("\n") + 1);
  const joiner = LIST_ITEM_LINE.test(lastLine) && LIST_ITEM_LINE.test(text) ? "\n" : "\n\n";
  return `${current}${joiner}${text}`;
}

/** The text with every line the phrase touches struck out. */
function struck(text: string, at: Span): string {
  const start = text.lastIndexOf("\n", at.from - 1) + 1;
  const newline = text.indexOf("\n", at.to);
  const end = newline === -1 ? text.length : newline + 1;
  return text.slice(0, start) + text.slice(end);
}

/** The text with the phrase replaced, or nothing where the phrase is not in it. */
function replacedIn(text: string, find: string, replacement: string): string | undefined {
  const at = located(text, find);
  return at === undefined ? undefined : text.slice(0, at.from) + replacement + text.slice(at.to);
}

/** A list with the one item holding the phrase changed, or nothing where no item, or more than one place, holds it. */
function replacedItem<Item>(
  items: readonly Item[],
  textsOf: (item: Item) => readonly string[],
  change: (item: Item) => Item | undefined,
  find: string,
): readonly Item[] | undefined {
  const index = soleHolder(items, textsOf, find);
  const item = items[index];
  if (item === undefined) return undefined;
  const changed = change(item);
  if (changed === undefined) return undefined;
  return items.map((standing, at) => (at === index ? changed : standing));
}

function mapDefined<A, B>(value: A | undefined, map: (value: A) => B): B | undefined {
  return value === undefined ? undefined : map(value);
}

/** A list of plain items with a note applied, or nothing where the note names no item. */
function itemsNoted<Item>(
  items: readonly Item[],
  note: PlanNote,
  textOf: (item: Item) => string,
  itemOf: (text: string) => Item,
): readonly Item[] | undefined {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      return [...items, itemOf(note.text)];
    case NOTE_KIND.REPLACE:
      return replacedItem(
        items,
        (item) => [textOf(item)],
        (item) =>
          mapDefined(replacedIn(textOf(item), note.find, note.text), (text) => itemOf(text.trim())),
        note.find,
      );
    case NOTE_KIND.REMOVE: {
      const index = soleHolder(items, (item) => [textOf(item)], note.find);
      return index === -1 ? undefined : items.filter((_, at) => at !== index);
    }
  }
}

/** One text field with a note applied, or nothing where the note names no phrase in it. */
function textNoted(current: string | null, note: PlanNote): string | null | undefined {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      return appended(current, note.text);
    case NOTE_KIND.REPLACE:
      return current === null
        ? undefined
        : mapDefined(replacedIn(current, note.find, note.text), answered);
    case NOTE_KIND.REMOVE: {
      const at = current === null ? undefined : located(current, note.find);
      return current === null || at === undefined ? undefined : answered(struck(current, at));
    }
  }
}

/** Whether a list is still within the template's bound on items. */
function withinItems(items: readonly unknown[]): boolean {
  return items.length <= PLAN_TEMPLATE_BOUNDS.MAX_ITEMS;
}

/**
 * The content with one note taken, or nothing where the note cannot be: a
 * phrase it names that the field does not hold, or a list grown past its
 * bound. Note that a note that cannot be
 * taken is never guessed into another, because an append standing in for a
 * correction would write the point twice.
 */
export function applyNote(content: PlanContent, note: PlanNote): PlanContent | undefined {
  const { fields, assumptions } = content;
  const field = note.field;
  if (field === PLAN_FIELD.OPEN_QUESTIONS) {
    const questions = itemsNoted(fields.openQuestions, note, (text) => text, itemText);
    if (questions === undefined || !withinItems(questions)) return undefined;
    return { fields: { ...fields, openQuestions: questions }, assumptions };
  }
  if (field === PLAN_FIELD.ASSUMPTIONS) {
    const noted = itemsNoted(
      assumptions,
      note,
      (item) => item.text,
      (text) => ({ text: itemText(text) }),
    );
    if (noted === undefined || !withinItems(noted)) return undefined;
    return { fields, assumptions: noted };
  }
  const text = textNoted(fields[field], note);
  return text === undefined ? undefined : { fields: { ...fields, [field]: text }, assumptions };
}

/** Notes taken over a plan's content: the content after, and the notes that could not be taken. */
export interface NotesTaken {
  readonly content: PlanContent;
  readonly missed: readonly PlanNote[];
}

/** Every note taken in order, and the notes that could not be. */
export function applyNotes(content: PlanContent, notes: readonly PlanNote[]): NotesTaken {
  let taken = content;
  const missed: PlanNote[] = [];
  for (const note of notes) {
    const next = applyNote(taken, note);
    if (next === undefined) missed.push(note);
    else taken = next;
  }
  return { content: taken, missed };
}

const readNote = readEither(planNoteSchema, { excess: EXCESS_KEYS.DROP });

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
  return Result.isSuccess(read) ? read.success : undefined;
}

/** An answer's notes as read, and how many of its notes did not read. */
export interface NotesRead {
  readonly notes: readonly PlanNote[];
  readonly unread: number;
}

/**
 * The notes of an answer, each read on its own so a note that does not read
 * is passed over alone rather than costing the rest, and how many were.
 */
export function readNotes(answer: UnparsedWireValue): NotesRead {
  const values = isRecord(answer) && Array.isArray(answer.notes) ? answer.notes : [];
  const notes = values.flatMap((value: UnparsedWireValue) => {
    const read = readNote(value);
    return Result.isSuccess(read) ? [read.success] : [];
  });
  return { notes: notes.slice(0, MAX_NOTES), unread: values.length - notes.length };
}

/**
 * The content as the notetaker's answer so far leaves it, for a draft drawn
 * while the answer streams. The answer arrives as the JSON emitted so far,
 * so every note before the last is whole, and each is taken in order; one
 * that does not read or cannot be taken is passed over alone. The last note
 * may be cut off partway, so it is drawn only when it adds a point, as the
 * text written so far, held back at a trailing line of nothing but Markdown
 * markers. Each draft therefore differs from the one before only where the
 * newest note lands, and nothing a draft showed is taken back until the
 * answer is saved.
 */
export function notesInProgress(content: PlanContent, partial: UnparsedWireValue): PlanContent {
  const values = isRecord(partial) && Array.isArray(partial.notes) ? partial.notes : [];
  const { notes: whole } = readNotes(unparsedWire({ notes: values.slice(0, -1) }));
  const growing = growingAddition(values.at(-1));
  return applyNotes(content, growing === undefined ? whole : [...whole, growing]).content;
}
