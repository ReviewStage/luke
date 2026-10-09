import type { CodeRef } from "@sidecar/hosted/plan-wire";

/**
 * code-pane-model.ts -- what the call's code pane says, apart from drawing it: its heading's range and the lines lit.
 */

/** The lines pointed at, as the heading reads them: "Lines 40–58", "Line 7", or nothing for a whole file. */
export function rangeLabel(ref: CodeRef): string | undefined {
  if (ref.startLine === undefined || ref.endLine === undefined) return undefined;
  return ref.startLine === ref.endLine
    ? `Line ${ref.startLine}`
    : `Lines ${ref.startLine}–${ref.endLine}`;
}

/** Whether `line` of the file is one the reference points at. */
export function isPointed(ref: CodeRef, line: number): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) return false;
  return line >= ref.startLine && line <= ref.endLine;
}
