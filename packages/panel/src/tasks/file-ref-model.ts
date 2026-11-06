import type { CodeRef } from "@repo/features/task-wire";
import type { SnippetLines } from "./code-snippet-model.js";

export interface NamedLines {
  readonly path: string;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}

export function lineRangeText(ref: Omit<NamedLines, "path">): string | undefined {
  if (ref.startLine === undefined || ref.endLine === undefined) return undefined;
  return ref.startLine === ref.endLine
    ? `Line ${ref.startLine}`
    : `Lines ${ref.startLine}–${ref.endLine}`;
}

export function fileRefText(ref: NamedLines): string {
  const lines = lineRangeText(ref);
  return lines === undefined ? ref.path : `${ref.path}, ${lines}`;
}

function isPointed(ref: CodeRef, line: number): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) return false;
  return line >= ref.startLine && line <= ref.endLine;
}

export function copiedLines(code: SnippetLines): string {
  const kept = code.lines.filter(
    (_line, at) => code.ref.startLine === undefined || isPointed(code.ref, code.firstLine + at),
  );
  return kept.join("\n");
}

export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function fileFolder(path: string): string | undefined {
  return path.slice(0, -fileName(path).length - 1) || undefined;
}
