/**
 * file-ref-model.ts -- how a file and its lines are named, apart from drawing them: how a range of lines is said, a file's name and folder, and what a copy of the lines pointed at carries.
 */

import type { CodeRef } from "@luke/features/task-wire";
import type { SnippetLines } from "./code-snippet-model.js";

/** A reference as a place names it, read from a call's input or a stored note, its lines absent for a whole file. */
export interface NamedLines {
  readonly path: string;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}

/**
 * The lines a reference points at, as every place naming them says them, a
 * file's chip and an inbox item's code alike: "Lines 40–58", "Line 7", or
 * nothing for a whole file.
 */
export function lineRangeText(ref: Omit<NamedLines, "path">): string | undefined {
  if (ref.startLine === undefined || ref.endLine === undefined) return undefined;
  return ref.startLine === ref.endLine
    ? `Line ${ref.startLine}`
    : `Lines ${ref.startLine}–${ref.endLine}`;
}

/** A reference as words, where its path and its lines are said in one breath: "src/invite.ts, Lines 40–58", or the path alone for a whole file. */
export function fileRefText(ref: NamedLines): string {
  const lines = lineRangeText(ref);
  return lines === undefined ? ref.path : `${ref.path}, ${lines}`;
}

/** Whether `line` of the file is one the reference points at. */
function isPointed(ref: CodeRef, line: number): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) return false;
  return line >= ref.startLine && line <= ref.endLine;
}

/** What a card's copy carries: the lines pointed at as plain text, or every line the card draws for a whole file. */
export function copiedLines(code: SnippetLines): string {
  const kept = code.lines.filter(
    (_line, at) => code.ref.startLine === undefined || isPointed(code.ref, code.firstLine + at),
  );
  return kept.join("\n");
}

/** A file's name, the last part of its path, as its tab is labelled. */
export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** The folder a file stands in, its path short of its name, as a row says it after the name; none at the repository's root. */
export function fileFolder(path: string): string | undefined {
  return path.slice(0, -fileName(path).length - 1) || undefined;
}
