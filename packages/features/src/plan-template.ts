import {
  EXCESS_KEYS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
} from "@luke/wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { mentionLinksIn } from "./mention-link.js";
import { taskPicturesIn } from "./plan-attachment-link.js";
import { openFenceAt, planSections } from "./plan-document.js";
import { PLAN_SECTION_BOUNDS, TASK_BOUNDS } from "./task-wire.js";
import { trimmedText } from "./text-schema.js";

/**
 * plan-template.ts -- the notes Luke takes into a plan's text, and the agents' journal of them.
 *
 * A plan is one Markdown text that starts empty (`plan-document.ts`,
 * `docs/TASKS.md`), its headings its sections.
 *
 * Luke changes the text only by taking notes, of two kinds: a point added
 * under a heading, and text replaced, the one generic edit, which names any
 * text standing exactly once in the plan, headings and whole sections
 * among it, and an empty replacement deletes. So a heading is renamed, a
 * section split, merged, moved, or struck, and a point moved between
 * sections the way a person edits a doc, while a draft drawn while the
 * notes stream differs from the one before only where the newest note
 * lands (`textNotesInProgress`). A batch of notes is taken whole or not at
 * all: a note naming text or a heading the plan does not hold exactly once
 * refuses every note beside it, so a move can never strike text without
 * placing it. A note's words are
 * contained where they land only so far as keeps the rest of the text as it
 * was: a line that would open an HTML block or underline the line above into
 * a heading is escaped, and a code fence left open is closed, so no note
 * swallows the text after it. The schema guarantees shape only; whether a note
 * is understood or agreed is the model's judgment.
 */

/** A code fence's opening or closing line: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

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

/**
 * One line outside a fence, with a backslash before whatever would open an
 * HTML block or underline the line above into a heading. Note that an ATX
 * heading is written as given, because a note may open a section, while a
 * setext heading is escaped, because the plan's sections are cut at `#`
 * headings alone and one drawn as a heading but read as none misleads both.
 */
function escapedLine(line: string, afterText: boolean): string {
  const opener = (afterText ? SETEXT_LINE.exec(line) : null) ?? HTML_LINE.exec(line);
  if (opener === null) return line;
  const at = opener[1]?.length ?? 0;
  return `${line.slice(0, at)}\\${line.slice(at)}`;
}

/**
 * A note's text as Markdown that leaves the text after it as it was. Note
 * that we leave a fence's own lines as written, because anything inside code
 * is code, and that we close a fence the text left open, because an open
 * fence would turn every heading after it into code.
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

/**
 * The kinds of note the notetaker takes: a point added under a heading, and
 * text replaced, which an empty replacement deletes. `REMOVE` is a kind the
 * agents' journal still holds and writes for a deletion, so a deployment
 * that reads only the older kinds reads every journal this one writes; no
 * model is offered it.
 */
export const NOTE_KIND = {
  ADD: "add",
  REPLACE: "replace",
  REMOVE: "remove",
} as const;

/** The most notes one answer may take. */
const MAX_NOTES = 40;

/** The heading a point goes under, as a note names one: the notetaker's and a coding agent's alike. */
export const planNoteSectionSchema = describeWire(
  trimmedText(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS),
  "The heading the point goes under, copied exactly from the plan's text, without its #s. " +
    "A heading the text does not hold opens a new section at its end.",
);

const addNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD),
  section: planNoteSectionSchema,
  text: describeWire(
    trimmedText(TASK_BOUNDS.MAX_BODY_CHARS),
    "The new point, added at the end of the section: Markdown, a bullet where the section " +
      "is a list.",
  ),
});

const replaceNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REPLACE),
  find: describeWire(
    trimmedText(TASK_BOUNDS.MAX_BODY_CHARS),
    "Text copied exactly from the plan's saved text, as much as names one place: a phrase, " +
      "lines, or whole sections, headings and their #s included.",
  ),
  text: describeWire(
    EffectSchema.Trim.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS)),
    "What that text becomes, which may open headings of its own; empty to delete it, and a " +
      "line the deletion leaves empty is taken out.",
  ),
});

const removeNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REMOVE),
  find: EffectSchema.String,
});

const planNoteSchema = EffectSchema.Union([addNoteSchema, replaceNoteSchema]);

/** One note: a point added under a heading, or text replaced or deleted. */
export type PlanNote = typeof planNoteSchema.Type;

/** What the notetaker answers each run with: the notes the latest lines call for, in the order taken. */
export const planNotesSchema = EffectSchema.Struct({
  notes: describeWire(
    EffectSchema.Array(planNoteSchema).check(EffectSchema.isMaxLength(MAX_NOTES)),
    "The notes the latest lines call for, in order, taken together or not at all; empty " +
      "when nothing new was said.",
  ),
});

/** One note as the agents' journal keeps it, a deletion among them as a strike. */
const journaledNoteSchema = EffectSchema.Union([
  addNoteSchema,
  replaceNoteSchema,
  removeNoteSchema,
]);

/** The most saves by coding agents a plan keeps word of; older ones fall off the front. */
const TASK_AGENT_EDITS_KEPT = 50;

/** The most of a replaced text the journal keeps: the bound the deployment before this one reads a phrase under. */
const JOURNAL_FIND_CHARS = 500;

/**
 * One save a coding agent made on the plan: which agent, when, and the notes
 * as they were taken. The agent is named by its id alone, so whoever reads
 * the journal names it by what its row says now.
 */
export const planAgentEditSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  /** Epoch milliseconds of the save. */
  at: EffectSchema.Number,
  notes: EffectSchema.Array(journaledNoteSchema),
});

export type PlanAgentEdit = typeof planAgentEditSchema.Type;

/**
 * A note as the journal keeps it, the text it replaced cut to the bound.
 * Note that a deletion is kept as a strike rather than an empty
 * replacement, and the text cut, because the deployment before this one
 * reads a replacement only with words and a phrase only so long, and a
 * journal it cannot read is a plan it cannot open.
 */
function journaledNote(note: PlanNote): PlanAgentEdit["notes"][number] {
  if (note.kind === NOTE_KIND.ADD) return note;
  const find = note.find.slice(0, JOURNAL_FIND_CHARS).trimEnd();
  return note.text === "" ? { kind: NOTE_KIND.REMOVE, find } : { ...note, find };
}

/** The journal with one more save on its end, its notes as the journal keeps them, the oldest let go past the bound. */
export function withAgentEdit(
  journal: readonly PlanAgentEdit[],
  edit: { readonly agentId: string; readonly at: number; readonly notes: readonly PlanNote[] },
): readonly PlanAgentEdit[] {
  return [...journal, { ...edit, notes: edit.notes.map(journaledNote) }].slice(
    -TASK_AGENT_EDITS_KEPT,
  );
}

/** A line that opens a Markdown list item. */
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/u;

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
 * The text with a point added at the end of the one section under the
 * note's heading, or, where the text has no such section, a new one at the
 * end of the text holding it; a fence the section or the text leaves open is
 * closed before it. Note that a heading standing over two sections is no
 * place to add to, because a point landing in the wrong one is the edit a
 * note must never make.
 */
function addedToText(
  text: string,
  note: Extract<PlanNote, { kind: typeof NOTE_KIND.ADD }>,
): string | undefined {
  const heading = note.section;
  const added = contained(note.text);
  const under = planSections(text).filter((each) => each.heading === heading);
  if (under.length > 1) return undefined;
  const section = under[0];
  if (section === undefined) {
    const head = fenceClosed(text.trimEnd());
    return `${head.length === 0 ? "" : `${head}\n\n`}## ${heading}\n\n${added}\n`;
  }
  const words = fenceClosed(section.text);
  const lines = words.split("\n");
  const grown = lines.length > 1 ? appended(words, added) : `${words}\n\n${added}`;
  return text.slice(0, section.from) + grown + text.slice(section.to);
}

/** Where the lines a span touches start and end: the first one's start, and just past the last one's line break. */
function linesOf(text: string, at: Span): Span {
  const from = text.lastIndexOf("\n", at.from - 1) + 1;
  // Note that the last line touched is the one holding the span's last character, so a span ending on a line break touches no line after it.
  const newline = text.indexOf("\n", Math.max(at.from, at.to - 1));
  return { from, to: newline === -1 ? text.length : newline + 1 };
}

/** The text with whole lines struck out, and the blank line they leave doubled taken back. */
function struckFromText(text: string, lines: Span): string {
  const head = text.slice(0, lines.from);
  const tail = text.slice(lines.to);
  if (tail.trim().length === 0) return head.replace(/\n+$/u, "\n");
  return head.endsWith("\n\n") || head.length === 0
    ? head + tail.replace(/^\n+/u, "")
    : head + tail;
}

/**
 * The text with the span deleted, or nothing where a deletion within lines
 * would drop a mention or a picture. Note that where the lines it touches hold nothing
 * else, they are struck whole, with the blank line they leave doubled taken
 * back, because a model deleting a point copies its words and not the line
 * break after them, and an empty line left standing is not what it meant.
 * Striking whole lines is a retraction, which may take a mention with it;
 * a deletion that leaves any of a line standing is a correction, and keeps
 * every mention whole, so it cannot cut one's target short.
 */
function deletedFromText(text: string, at: Span): string | undefined {
  const lines = linesOf(text, at);
  const rest = text.slice(lines.from, at.from) + text.slice(at.to, lines.to);
  if (rest.trim().length === 0) return struckFromText(text, lines);
  const deleted = text.slice(0, at.from) + text.slice(at.to);
  return keepsMentions(text, deleted) && keepsPictures(text, deleted) ? deleted : undefined;
}

/**
 * The text with the one place `find` stands replaced, or nothing where it
 * stands nowhere or more than once, or the replacement would drop a mention
 * or a picture.
 * An empty replacement deletes (`deletedFromText`).
 */
function replacedInText(
  text: string,
  note: Extract<PlanNote, { kind: typeof NOTE_KIND.REPLACE }>,
): string | undefined {
  const at = located(text, note.find);
  if (at === undefined) return undefined;
  if (note.text === "") return deletedFromText(text, at);
  // A replacement inside a fence is code, written as given rather than contained as prose.
  const words = openFenceAt(text, at.from) === undefined ? contained(note.text) : note.text;
  const replaced = text.slice(0, at.from) + words + text.slice(at.to);
  return keepsMentions(text, replaced) && keepsPictures(text, replaced) ? replaced : undefined;
}

/**
 * A document's text with one note taken, or nothing where the note cannot
 * be: an addition at the end of the one section under its heading, or as a
 * new section at the end of the text where it has none; a replacement names text
 * that must stand exactly once in the whole text, headings among it, so a
 * heading is renamed, a section moved or struck, and a point moved between
 * sections by replacements alone.
 */
function applyNoteToText(text: string, note: PlanNote): string | undefined {
  return note.kind === NOTE_KIND.ADD ? addedToText(text, note) : replacedInText(text, note);
}

/** Whether a text after a change holds every address `addressesIn` finds in it before, each copy counted. */
function keepsAddresses(
  before: string,
  after: string,
  addressesIn: (text: string) => readonly string[],
): boolean {
  // Note that every copy is counted, each alike, however many the plan holds.
  const counted = (text: string) => {
    const counts = new Map<string, number>();
    for (const address of addressesIn(text)) counts.set(address, (counts.get(address) ?? 0) + 1);
    return counts;
  };
  const kept = counted(after);
  return [...counted(before)].every(([address, count]) => (kept.get(address) ?? 0) >= count);
}

/**
 * Whether a correction keeps every mention the text held: a link whose
 * label starts with `@`, which the developer placed. A correction may
 * reword around one, or its name, but one that drops it or breaks its
 * target is not taken, as a note naming a phrase the text does not hold
 * is not; striking the line a mention stands on is a retraction, and is.
 * A mention is counted by its target as written, whatever it names, so
 * one of a page this text cannot read, another repository's file among
 * them, is kept as surely as one it can.
 */
function keepsMentions(before: string, after: string): boolean {
  return keepsAddresses(before, after, (text) => mentionLinksIn(text).map(({ target }) => target));
}

/**
 * Whether a correction keeps every picture the text held, counted by its
 * address (`planPicturesIn`), on the same terms as a mention: a correction
 * may reword a picture's alt text or caption, or move it within the phrase
 * it corrects, but one that drops it, or leaves its address as a link that
 * draws no picture, is not taken; striking the
 * line a picture stands on is a retraction, and is. A picture of another
 * plan is kept as surely as one of this plan.
 */
function keepsPictures(before: string, after: string): boolean {
  return keepsAddresses(before, after, taskPicturesIn);
}

/**
 * Notes taken over a document's text: the text with every note taken, or,
 * where one could not be, the text as it stood and the first note that
 * could not, which refuses the whole batch.
 */
export interface TextNotesTaken {
  readonly text: string;
  readonly missed?: PlanNote;
}

/** Notes taken in order until one cannot be: the text so far, and the note that stopped them. */
function takenInOrder(text: string, notes: readonly PlanNote[]): TextNotesTaken {
  let taken = text;
  for (const note of notes) {
    const next = applyNoteToText(taken, note);
    if (next === undefined) return { text: taken, missed: note };
    taken = next;
  }
  return { text: taken };
}

/**
 * Every note taken over a document's text in order, each over the text the
 * ones before it left, or none of them. Note that one note that cannot be
 * taken refuses the batch whole, because the notes of one answer are one
 * edit, and a move written as a strike and an addition must not land half.
 */
export function applyNotesToText(text: string, notes: readonly PlanNote[]): TextNotesTaken {
  const taken = takenInOrder(text, notes);
  return taken.missed === undefined ? taken : { text, missed: taken.missed };
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
 * The notes of an answer that read, each read on its own, and how many did
 * not, which is how many a save would be missing: a caller takes an answer
 * with any unread note as no edit at all.
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
 * far, so every note before the last is whole, and each is taken in order
 * up to the first that does not read or cannot be taken, since the save
 * refuses an answer holding one, and the draft ends there. The last
 * note may be cut off partway, so it is drawn only when it adds a point, as
 * the text written so far, held back at a trailing line of nothing but
 * Markdown markers. Each draft therefore differs from the one before only
 * where the newest note lands.
 */
export function textNotesInProgress(text: string, partial: UnparsedWireValue): string {
  return takenInOrder(text, notesSoFar(partial)).text;
}

/** The notes an answer so far holds: every whole note up to the first that does not read, then the last, while it adds a point, as written so far. */
function notesSoFar(partial: UnparsedWireValue): readonly PlanNote[] {
  const values = isRecord(partial) && Array.isArray(partial.notes) ? partial.notes : [];
  const whole: PlanNote[] = [];
  for (const value of values.slice(0, -1)) {
    const read = readNote(value);
    if (Result.isFailure(read)) return whole;
    whole.push(read.success);
  }
  const growing = growingAddition(values.at(-1));
  return growing === undefined ? whole : [...whole, growing];
}
