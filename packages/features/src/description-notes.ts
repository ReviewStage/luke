import { EXCESS_KEYS, isRecord, type UnparsedWireValue } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { mentionLinksIn } from "./mention-link.js";
import { taskPicturesIn } from "./description-attachment-link.js";
import { openFenceAt, descriptionSections } from "./description-document.js";
import { DESCRIPTION_SECTION_BOUNDS, TASK_BOUNDS } from "./task-wire.js";
import { trimmedText } from "./text-schema.js";

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

const SETEXT_LINE = /^( {0,3}(?:>[ \t]*)*)(?=(?:=+|-+)[ \t]*$)/u;

const HTML_LINE = /^( {0,3})(?=<)/u;

interface OpenFence {
  readonly marker: string;
}

function fenceOpened(line: string): OpenFence | undefined {
  const match = FENCE_LINE.exec(line);
  const marker = match?.[1];
  if (marker === undefined) return undefined;
  if (marker.startsWith("`") && (match?.[2] ?? "").includes("`")) return undefined;
  return { marker };
}

function fenceCloses(line: string, fence: OpenFence): boolean {
  const match = FENCE_LINE.exec(line);
  const marker = match?.[1];
  if (marker === undefined) return false;
  const sameCharacter = marker[0] === fence.marker[0];
  return sameCharacter && marker.length >= fence.marker.length && (match?.[2] ?? "").trim() === "";
}

function escapedLine(line: string, afterText: boolean): string {
  const opener = (afterText ? SETEXT_LINE.exec(line) : null) ?? HTML_LINE.exec(line);
  if (opener === null) return line;
  const at = opener[1]?.length ?? 0;
  return `${line.slice(0, at)}\\${line.slice(at)}`;
}

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

export const NOTE_KIND = {
  ADD: "add",
  REPLACE: "replace",
  REMOVE: "remove",
} as const;

const MAX_NOTES = 40;

export const descriptionNoteSectionSchema = describeWire(
  trimmedText(DESCRIPTION_SECTION_BOUNDS.MAX_HEADING_CHARS),
  "The heading the point goes under, copied exactly from the description's text, without its #s. " +
    "A heading the text does not hold opens a new section at its end.",
);

const addNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD),
  section: descriptionNoteSectionSchema,
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
    "Text copied exactly from the description's saved text, as much as names one place: a phrase, " +
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

const descriptionNoteSchema = EffectSchema.Union([addNoteSchema, replaceNoteSchema]);

export type DescriptionNote = typeof descriptionNoteSchema.Type;

export const descriptionNotesSchema = EffectSchema.Struct({
  notes: describeWire(
    EffectSchema.Array(descriptionNoteSchema).check(EffectSchema.isMaxLength(MAX_NOTES)),
    "The notes the latest lines call for, in order, taken together or not at all; empty " +
      "when nothing new was said.",
  ),
});

const journaledNoteSchema = EffectSchema.Union([
  addNoteSchema,
  replaceNoteSchema,
  removeNoteSchema,
]);

const TASK_AGENT_EDITS_KEPT = 50;

const JOURNAL_FIND_CHARS = 500;

export const descriptionAgentEditSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  at: EffectSchema.Number,
  notes: EffectSchema.Array(journaledNoteSchema),
});

export type DescriptionAgentEdit = typeof descriptionAgentEditSchema.Type;

function journaledNote(note: DescriptionNote): DescriptionAgentEdit["notes"][number] {
  if (note.kind === NOTE_KIND.ADD) return note;
  const find = note.find.slice(0, JOURNAL_FIND_CHARS).trimEnd();
  return note.text === "" ? { kind: NOTE_KIND.REMOVE, find } : { ...note, find };
}

export function withAgentEdit(
  journal: readonly DescriptionAgentEdit[],
  edit: {
    readonly agentId: string;
    readonly at: number;
    readonly notes: readonly DescriptionNote[];
  },
): readonly DescriptionAgentEdit[] {
  return [...journal, { ...edit, notes: edit.notes.map(journaledNote) }].slice(
    -TASK_AGENT_EDITS_KEPT,
  );
}

const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/u;

function escapedPattern(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface Span {
  readonly from: number;
  readonly to: number;
}

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

export function locatedPhrase(text: string, find: string): Span | undefined {
  const spans = spansOf(text, find);
  return spans.length === 1 ? spans[0] : undefined;
}

function appended(current: string | null, text: string): string {
  if (current === null) return text;
  const lastLine = current.slice(current.lastIndexOf("\n") + 1);
  const joiner = LIST_ITEM_LINE.test(lastLine) && LIST_ITEM_LINE.test(text) ? "\n" : "\n\n";
  return `${current}${joiner}${text}`;
}

function fenceClosed(words: string): string {
  const open = openFenceAt(words, words.length + 1);
  return open === undefined ? words : `${words}\n${open}`;
}

function addedToText(
  text: string,
  note: Extract<DescriptionNote, { kind: typeof NOTE_KIND.ADD }>,
): string | undefined {
  const heading = note.section;
  const added = contained(note.text);
  const under = descriptionSections(text).filter((each) => each.heading === heading);
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

function linesOf(text: string, at: Span): Span {
  const from = text.lastIndexOf("\n", at.from - 1) + 1;
  const newline = text.indexOf("\n", Math.max(at.from, at.to - 1));
  return { from, to: newline === -1 ? text.length : newline + 1 };
}

function struckFromText(text: string, lines: Span): string {
  const head = text.slice(0, lines.from);
  const tail = text.slice(lines.to);
  if (tail.trim().length === 0) return head.replace(/\n+$/u, "\n");
  return head.endsWith("\n\n") || head.length === 0
    ? head + tail.replace(/^\n+/u, "")
    : head + tail;
}

function deletedFromText(text: string, at: Span): string | undefined {
  const lines = linesOf(text, at);
  const rest = text.slice(lines.from, at.from) + text.slice(at.to, lines.to);
  if (rest.trim().length === 0) return struckFromText(text, lines);
  const deleted = text.slice(0, at.from) + text.slice(at.to);
  return keepsMentions(text, deleted) && keepsPictures(text, deleted) ? deleted : undefined;
}

function replacedInText(
  text: string,
  note: Extract<DescriptionNote, { kind: typeof NOTE_KIND.REPLACE }>,
): string | undefined {
  const at = locatedPhrase(text, note.find);
  if (at === undefined) return undefined;
  if (note.text === "") return deletedFromText(text, at);
  const words = openFenceAt(text, at.from) === undefined ? contained(note.text) : note.text;
  const replaced = text.slice(0, at.from) + words + text.slice(at.to);
  return keepsMentions(text, replaced) && keepsPictures(text, replaced) ? replaced : undefined;
}

function applyNoteToText(text: string, note: DescriptionNote): string | undefined {
  return note.kind === NOTE_KIND.ADD ? addedToText(text, note) : replacedInText(text, note);
}

function keepsAddresses(
  before: string,
  after: string,
  addressesIn: (text: string) => readonly string[],
): boolean {
  const counted = (text: string) => {
    const counts = new Map<string, number>();
    for (const address of addressesIn(text)) counts.set(address, (counts.get(address) ?? 0) + 1);
    return counts;
  };
  const kept = counted(after);
  return [...counted(before)].every(([address, count]) => (kept.get(address) ?? 0) >= count);
}

function keepsMentions(before: string, after: string): boolean {
  return keepsAddresses(before, after, (text) => mentionLinksIn(text).map(({ target }) => target));
}

function keepsPictures(before: string, after: string): boolean {
  return keepsAddresses(before, after, taskPicturesIn);
}

export interface TextNotesTaken {
  readonly text: string;
  readonly missed?: DescriptionNote;
}

function takenInOrder(text: string, notes: readonly DescriptionNote[]): TextNotesTaken {
  let taken = text;
  for (const note of notes) {
    const next = applyNoteToText(taken, note);
    if (next === undefined) return { text: taken, missed: note };
    taken = next;
  }
  return { text: taken };
}

export function applyNotesToText(text: string, notes: readonly DescriptionNote[]): TextNotesTaken {
  const taken = takenInOrder(text, notes);
  return taken.missed === undefined ? taken : { text, missed: taken.missed };
}

const readNote = readEither(descriptionNoteSchema, { excess: EXCESS_KEYS.DROP });

export interface NotesRead {
  readonly notes: readonly DescriptionNote[];
  readonly unread: number;
}

export function readNotes(answer: UnparsedWireValue): NotesRead {
  const values = isRecord(answer) && Array.isArray(answer.notes) ? answer.notes : [];
  const notes = values.flatMap((value: UnparsedWireValue) => {
    const read = readNote(value);
    return Result.isSuccess(read) ? [read.success] : [];
  });
  return { notes: notes.slice(0, MAX_NOTES), unread: values.length - notes.length };
}
