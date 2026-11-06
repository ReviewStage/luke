import type { CodeRef } from "@repo/features/task-wire";
import { DIFF_SELECTION_SIDE, type DiffSelection } from "../diff-view/contract.js";

export interface SnippetLines {
  readonly ref: CodeRef;
  readonly firstLine: number;
  readonly lines: readonly string[];
}

export interface SnippetRange {
  readonly startLine: number;
  readonly endLine: number;
}

const CONTEXT_MARK = " ";

export function snippetRange(code: SnippetLines): SnippetRange | undefined {
  if (code.lines.length === 0) return undefined;
  return { startLine: code.firstLine, endLine: code.firstLine + code.lines.length - 1 };
}

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

export function pointedRange(code: SnippetLines): SnippetRange | undefined {
  const drawn = snippetRange(code);
  const { startLine, endLine } = code.ref;
  if (drawn === undefined || startLine === undefined || endLine === undefined) return undefined;
  const from = Math.max(startLine, drawn.startLine);
  const to = Math.min(endLine, drawn.endLine);
  return from > to ? undefined : { startLine: from, endLine: to };
}

export function litSelection(range: SnippetRange | undefined): DiffSelection | undefined {
  if (range === undefined) return undefined;
  return {
    start: range.startLine,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: range.endLine,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };
}
