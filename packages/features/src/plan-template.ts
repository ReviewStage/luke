import {
  EXCESS_KEYS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
} from "@luke/wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { encodeMention, mentionsIn } from "./mention-link.js";
import { openFenceAt, type PlanSection, planSections } from "./plan-document.js";
import { PLAN_BOUNDS, PLAN_SECTION_BOUNDS, type PlanField } from "./plan-wire.js";

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
 * template once named its fields by (`PLAN_FIELD`).
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
 * ones after it. A point added to a section that still holds exactly what
 * the plan's template put there, one paragraph of guidance, takes the place
 * of that guidance, so a filled section never keeps its prompt above its
 * answer. The schema
 * guarantees shape only; whether a note is understood or agreed is the
 * model's judgment.
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

const planNoteSchema = EffectSchema.Union([addNoteSchema, replaceNoteSchema, removeNoteSchema]);

/** One note: a point added under a heading, a phrase corrected, or a line struck. */
export type PlanNote = typeof planNoteSchema.Type;

/** What the notetaker answers each run with: the notes the latest lines call for, in the order taken. */
export const planNotesSchema = EffectSchema.Struct({
  notes: describeWire(
    EffectSchema.Array(planNoteSchema).check(EffectSchema.isMaxLength(MAX_NOTES)),
    "The notes the latest lines call for, in order; empty when nothing new was said.",
  ),
});

/** The most saves by coding agents a plan keeps word of; older ones fall off the front. */
const PLAN_AGENT_EDITS_KEPT = 50;

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

/** A line of a template's section that opens anything but prose: a list item, a fence, a quote, a table row, or a heading. */
const STARTER_CONTENT_LINE = /^\s*(?:(?:[-*+]|\d{1,9}[.)])(?:\s|$)|`{3,}|~{3,}|>|\||#)/u;

/** A trailing line still being written that holds nothing but Markdown markers, whose escaping would change as it grows. */
const MARKER_ONLY_LINE = /^[\s#>*+=`~<\-\d.)]+$/u;

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
 * Whether a section still holds exactly what the plan's template put under
 * its heading, and that is guidance: one paragraph of prose. Note that a
 * template's list, code, quote, table, or deeper heading is never taken for
 * guidance, because a template may start a section with content of its own,
 * and that is kept with the point added after it. Never where the template
 * the plan started from is not known.
 */
function guidanceOnly(section: PlanSection, started: string | undefined): boolean {
  if (started === undefined) return false;
  const was = planSections(started).find((each) => each.heading === section.heading);
  if (was?.text !== section.text) return false;
  const lines = section.text.split("\n").slice(1).join("\n").trim().split("\n");
  return lines.every((line) => line.trim().length > 0 && !STARTER_CONTENT_LINE.test(line));
}

/**
 * The text with a point added at the end of the first section under the
 * note's heading, or, where the text has no such section, a new one at the
 * end of the text holding it; a fence the section or the text leaves open is
 * closed before it. Note that a section still holding only its template's
 * guidance takes the point in place of the guidance, because the guidance is
 * the developer's prompt for the section and filled, it is no longer wanted.
 */
function addedToText(
  text: string,
  note: Extract<PlanNote, { kind: typeof NOTE_KIND.ADD }>,
  started: string | undefined,
): string {
  const heading = note.section;
  const added = contained(note.text);
  const section = planSections(text).find((each) => each.heading === heading);
  if (section === undefined) {
    const head = fenceClosed(text.trimEnd());
    return `${head.length === 0 ? "" : `${head}\n\n`}## ${heading}\n\n${added}\n`;
  }
  if (guidanceOnly(section, started)) {
    const headingLine = section.text.split("\n", 1)[0] ?? "";
    return `${text.slice(0, section.from)}${headingLine}\n\n${added}${text.slice(section.to)}`;
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
 * be: an addition at the end of the first section under its heading, in
 * place of the template's guidance where the section holds only that, or as
 * a new section at the end of the text where it has none; a correction
 * or a strike names a phrase that must stand exactly once in the whole text
 * and touch no heading, since the headings are the developer's and a note
 * writes under them.
 */
function applyNoteToText(
  text: string,
  note: PlanNote,
  started: string | undefined,
): string | undefined {
  if (note.kind === NOTE_KIND.ADD) return addedToText(text, note, started);
  const at = located(text, note.find);
  if (at === undefined || touchesHeading(text, at)) return undefined;
  if (note.kind === NOTE_KIND.REMOVE) return struckFromText(text, at);
  // A correction inside a fence is code, written as given rather than contained as prose.
  const words = openFenceAt(text, at.from) === undefined ? contained(note.text) : note.text;
  const corrected = text.slice(0, at.from) + words + text.slice(at.to);
  return keepsMentions(text, corrected) ? corrected : undefined;
}

/**
 * Whether a correction keeps every mention the text held: a link whose
 * label starts with `@`, which the developer placed. A correction may
 * reword around one, or its name, but one that drops it or breaks its
 * target is not taken, as a note naming a phrase the text does not hold
 * is not; striking the line a mention stands on is a retraction, and is.
 */
function keepsMentions(before: string, after: string): boolean {
  // Note that every mention is counted, each copy of one alike, however many the plan holds.
  const counted = (text: string) => {
    const counts = new Map<string, number>();
    for (const { mention } of mentionsIn(text, Number.POSITIVE_INFINITY)) {
      const target = encodeMention(mention);
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return counts;
  };
  const kept = counted(after);
  return [...counted(before)].every(([target, count]) => (kept.get(target) ?? 0) >= count);
}

/** Notes taken over a document's text: the text after, and the notes that could not be taken. */
export interface TextNotesTaken {
  readonly text: string;
  readonly missed: readonly PlanNote[];
}

/**
 * Every note taken over a document's text in order, and the notes that could
 * not be. `started` is the template text the plan started as, where it is
 * known, so a section still holding only its guidance takes its first point
 * in place of it; without it every point is added after what stands.
 */
export function applyNotesToText(
  text: string,
  notes: readonly PlanNote[],
  started?: string,
): TextNotesTaken {
  let taken = text;
  const missed: PlanNote[] = [];
  for (const note of notes) {
    const next = applyNoteToText(taken, note, started);
    if (next === undefined) missed.push(note);
    else taken = next;
  }
  return { text: taken, missed };
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
 * A document's text as the notetaker's answer so far leaves it, for a draft
 * drawn while the answer streams. The answer arrives as the JSON emitted so
 * far, so every note before the last is whole, and each is taken in order;
 * one that does not read or cannot be taken is passed over alone. The last
 * note may be cut off partway, so it is drawn only when it adds a point, as
 * the text written so far, held back at a trailing line of nothing but
 * Markdown markers. Each draft therefore differs from the one before only
 * where the newest note lands.
 */
export function textNotesInProgress(
  text: string,
  partial: UnparsedWireValue,
  started?: string,
): string {
  return applyNotesToText(text, notesSoFar(partial), started).text;
}

/** The notes an answer so far holds: every whole note that reads, then the last, while it adds a point, as written so far. */
function notesSoFar(partial: UnparsedWireValue): readonly PlanNote[] {
  const values = isRecord(partial) && Array.isArray(partial.notes) ? partial.notes : [];
  const { notes: whole } = readNotes(unparsedWire({ notes: values.slice(0, -1) }));
  const growing = growingAddition(values.at(-1));
  return growing === undefined ? whole : [...whole, growing];
}
