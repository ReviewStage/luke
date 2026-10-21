import type { CodeRef } from "@luke/features/task-wire";
import { DIFF_SELECTION_SIDE, type DiffSelection } from "../diff-view/contract.js";

/**
 * code-snippet-model.ts -- a snippet of a file as the diff bundle draws it, apart from drawing it: its lines as a hunk of nothing but context, numbered from where they sit in the file, the lines it points at lit, and the line a note on it stands under.
 *
 * Pierre numbers a plain file from its first line and has no way to start
 * at another, so a snippet, lines N to N+M-1 of a file, is handed to it as
 * a patch whose one hunk changes nothing (`@@ -N,M +N,M @@`), every line a
 * context line, as the review threads' previews already are. Drawn
 * unified, with no marks and no tints, it reads as the file's own lines,
 * each numbered where it sits.
 */

/** The lines of a file a snippet holds: the file's line the first is, and their text, in order. */
export interface SnippetLines {
  readonly ref: CodeRef;
  readonly firstLine: number;
  readonly lines: readonly string[];
}

/** A run of a snippet's lines, from its first to its last, counted in the file. */
export interface SnippetRange {
  readonly startLine: number;
  readonly endLine: number;
}

/** What a hunk's line that changes nothing opens with, as git writes one. */
const CONTEXT_MARK = " ";

/** The run of the file's lines the snippet draws; none where it holds no lines. */
export function snippetRange(code: SnippetLines): SnippetRange | undefined {
  if (code.lines.length === 0) return undefined;
  return { startLine: code.firstLine, endLine: code.firstLine + code.lines.length - 1 };
}

/**
 * The snippet as a patch, headed as git writes one, its one hunk holding
 * every line as context from the file's line the first one is; none where
 * it holds no lines, since a hunk of none draws nothing.
 */
export function snippetPatch(code: SnippetLines): string | undefined {
  if (snippetRange(code) === undefined) return undefined;
  const { path } = code.ref;
  const count = code.lines.length;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${code.firstLine},${count} +${code.firstLine},${count} @@`,
    ...code.lines.map((line) => `${CONTEXT_MARK}${line}`),
    "",
  ].join("\n");
}

/**
 * The lines the snippet points at, as far as it draws them; none where it
 * points at none, as a file shown from its top, or at none it draws.
 */
export function pointedRange(code: SnippetLines): SnippetRange | undefined {
  const drawn = snippetRange(code);
  const { startLine, endLine } = code.ref;
  if (drawn === undefined || startLine === undefined || endLine === undefined) return undefined;
  const from = Math.max(startLine, drawn.startLine);
  const to = Math.min(endLine, drawn.endLine);
  return from > to ? undefined : { startLine: from, endLine: to };
}

/** A run of the snippet's lines as the bundle lights it, on the side every line of a hunk of context counts on. */
export function litSelection(range: SnippetRange | undefined): DiffSelection | undefined {
  if (range === undefined) return undefined;
  return {
    start: range.startLine,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: range.endLine,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };
}

/**
 * The lines a note on the snippet is on: those it points at, or, for a
 * file shown from its top, every line it draws; none where it draws none.
 * The note stands under the last of them.
 */
export function noteRange(code: SnippetLines): SnippetRange | undefined {
  return pointedRange(code) ?? snippetRange(code);
}
