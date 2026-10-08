import type { CodeRef } from "@sidecar/hosted/plan-wire";
import { CODE_UNREADABLE, type PlanCode } from "@sidecar/hosted/planning-view";

/**
 * code-pane-model.ts -- what the call's code pane says, apart from drawing it: its heading's range, the lines lit, and why a file drew nothing.
 */

const UNREADABLE_LINES = {
  [CODE_UNREADABLE.NO_FOLDER]: "This plan has no folder on this Mac to read the file from.",
  [CODE_UNREADABLE.MISSING]: "No such file in the plan's folder.",
  [CODE_UNREADABLE.REFUSED]: "That file is outside the plan's folder, or holds secrets.",
  [CODE_UNREADABLE.TOO_LARGE]: "That file is too large to show, or is not text.",
} as const;

/** Why the code named drew no lines, in the pane's words; nothing where it drew. */
export function unreadableLine(code: PlanCode): string | undefined {
  return code.unreadable === undefined ? undefined : UNREADABLE_LINES[code.unreadable];
}

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
