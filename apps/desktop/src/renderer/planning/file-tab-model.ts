import {
  PLAN_FILE_BOUNDS,
  PLAN_FILE_REFUSAL,
  type PlanFileRefusal,
} from "@sidecar/hosted/plan-wire";
import type { PlanCode, PlanFileShown } from "@sidecar/hosted/planning-view";

/**
 * file-tab-model.ts -- what a File tab holds of its file, apart from drawing it: the windows read so far, joined into one run of lines, and why a file is not shown.
 */

/** Where a File tab's read of its file stands. */
export const FILE_READ = {
  READING: "reading",
  READY: "ready",
  /** The service answered why the file is not shown. */
  REFUSED: "refused",
  /** The read did not land: the service did not answer, or main refused it. */
  FAILED: "failed",
} as const;

/** The lines read so far, one run from `firstLine`, of a file of `lineCount` lines. */
export interface FileLines {
  readonly repository: string;
  readonly lineCount: number;
  readonly firstLine: number;
  readonly lines: PlanCode["lines"];
}

export type FileRead =
  | { readonly kind: typeof FILE_READ.READING }
  | ({ readonly kind: typeof FILE_READ.READY } & FileLines)
  | { readonly kind: typeof FILE_READ.REFUSED; readonly refusal: PlanFileRefusal }
  | { readonly kind: typeof FILE_READ.FAILED };

/** One window of a file, its first and last line. */
export interface FileWindow {
  readonly firstLine: number;
  readonly lastLine: number;
}

/** What a File tab says in its file's place, for each reason the file is not shown. */
export const FILE_REFUSAL_LINE = {
  [PLAN_FILE_REFUSAL.SECRET]: "This file holds secrets, such as a .env, and is never shown.",
  [PLAN_FILE_REFUSAL.MISSING]: "This file is no longer in the repository.",
  [PLAN_FILE_REFUSAL.NOT_TEXT]: "This file is too large to show, or is not text.",
  [PLAN_FILE_REFUSAL.NO_REPOSITORY]: "This plan has no repository.",
  [PLAN_FILE_REFUSAL.NOT_REACHABLE]:
    "The Luke GitHub App no longer reaches this plan's repository.",
  [PLAN_FILE_REFUSAL.SIGN_IN_REQUIRED]: "Sign in with GitHub again to read this file.",
  [PLAN_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read just now.",
} as const satisfies Record<PlanFileRefusal, string>;

/** Whether a refusal may pass with time, so the tab offers to read again. */
export function refusalPasses(refusal: PlanFileRefusal): boolean {
  return refusal === PLAN_FILE_REFUSAL.UNAVAILABLE;
}

/**
 * The window a line stands in: windows are counted from the file's first
 * line, each as long as one read carries, so the windows read above and
 * below one join it exactly.
 */
export function windowAt(line: number): FileWindow {
  const { WINDOW_LINES } = PLAN_FILE_BOUNDS;
  const firstLine = Math.floor((Math.max(1, line) - 1) / WINDOW_LINES) * WINDOW_LINES + 1;
  return { firstLine, lastLine: firstLine + WINDOW_LINES - 1 };
}

/** The last line a run of lines holds. */
export function lastLineOf(held: FileLines): number {
  return held.firstLine + held.lines.length - 1;
}

/** Whether every line of a range stands in the run held. */
export function holdsLines(held: FileLines, startLine: number, endLine: number): boolean {
  return startLine >= held.firstLine && endLine <= lastLineOf(held);
}

/**
 * The run held with a window read laid beside it: the window just after
 * the run is joined below it, the one just before above it, and any other
 * starts the run afresh. The file's length is the newest read's, since the
 * file is read as it stands at each read.
 */
export function withWindow(held: FileRead, read: PlanFileShown): FileLines {
  const window: FileLines = {
    repository: read.repository,
    lineCount: read.lineCount,
    firstLine: read.firstLine,
    lines: read.lines,
  };
  if (held.kind !== FILE_READ.READY) return window;
  if (read.firstLine === lastLineOf(held) + 1) {
    return { ...window, firstLine: held.firstLine, lines: [...held.lines, ...read.lines] };
  }
  if (read.firstLine + read.lines.length === held.firstLine) {
    return { ...window, lines: [...read.lines, ...held.lines] };
  }
  return window;
}
