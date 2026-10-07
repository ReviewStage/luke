import type { CodeRef } from "@sidecar/hosted/plan-wire";
import { CODE_SOURCE, CODE_UNREADABLE, type PlanCode } from "@sidecar/hosted/planning-view";

/**
 * code-pane-model.ts -- what the call's code pane says and decides, apart from drawing it: its heading, why a file drew nothing, the lines a drag selects, and the quick open's matches.
 */

/** The most files the quick open lists for one query. */
const QUICK_OPEN_MAX_MATCHES = 30;

/** What the pane says while nothing is on it. */
export const CODE_PANE_EMPTY_LINE =
  "Luke shows code here as he talks about it. Open a file to show him one.";

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

/** Who put the code on screen, as its badge reads. */
export function sourceLabel(code: PlanCode): string {
  return code.source === CODE_SOURCE.LUKE ? "Luke" : "You";
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

/** The reference a drag from `anchor` to `line` selects in the file at `path`, in order whichever way it went. */
export function selectedRef(path: string, anchor: number, line: number): CodeRef {
  return { path, startLine: Math.min(anchor, line), endLine: Math.max(anchor, line) };
}

/** Whether every character of `query` appears in `text` in order. */
function isSubsequence(query: string, text: string): boolean {
  let at = 0;
  for (const character of text) {
    if (character === query[at]) at += 1;
    if (at === query.length) return true;
  }
  return at === query.length;
}

/** How well a path answers a query: lower is better, undefined where it does not. */
function matchRank(query: string, path: string): number | undefined {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (lower.includes(query)) return 2;
  if (isSubsequence(query, lower)) return 3;
  return undefined;
}

/**
 * The files a quick-open query matches, best first: a file whose name starts
 * with it, then one whose name holds it, then whose path does, then whose
 * path holds its letters in order; shorter paths first within each.
 */
export function quickOpenMatches(files: readonly string[], query: string): readonly string[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return files.slice(0, QUICK_OPEN_MAX_MATCHES);
  const ranked: { path: string; rank: number }[] = [];
  for (const path of files) {
    const rank = matchRank(wanted, path);
    if (rank !== undefined) ranked.push({ path, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.path.length - b.path.length);
  return ranked.slice(0, QUICK_OPEN_MAX_MATCHES).map((match) => match.path);
}
