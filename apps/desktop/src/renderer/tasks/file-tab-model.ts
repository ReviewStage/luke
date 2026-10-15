import {
  TASK_FILE_BOUNDS,
  TASK_FILE_REFUSAL,
  type TaskFileRefusal,
} from "@luke/features/task-wire";
import type {
  TaskCode,
  TaskCodeShowing,
  TaskFileShown,
  TasksFileAnswer,
} from "@luke/features/tasks-view";
import { githubPath } from "./coding-agent-model";
import type { OpenFile } from "./use-side-panel";

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

/** The lines read so far, one run from `firstLine`, of a file of `lineCount` lines, read on `branch`, at `commit` where the service named the commit. */
export interface FileLines {
  readonly repository: string;
  readonly branch: string;
  readonly commit: string | undefined;
  readonly lineCount: number;
  readonly firstLine: number;
  readonly lines: TaskCode["lines"];
}

export type FileRead =
  | { readonly kind: typeof FILE_READ.READING }
  | ({ readonly kind: typeof FILE_READ.READY } & FileLines)
  | {
      readonly kind: typeof FILE_READ.REFUSED;
      readonly refusal: TaskFileRefusal;
      /** The branch GitHub found nothing at the path on, where the service named it. */
      readonly branch: string | undefined;
    }
  | { readonly kind: typeof FILE_READ.FAILED };

/** One window of a file, its first and last line. */
export interface FileWindow {
  readonly firstLine: number;
  readonly lastLine: number;
}

/** What a File tab says in its file's place, for each reason the file is not shown. */
const FILE_REFUSAL_LINE = {
  [TASK_FILE_REFUSAL.SECRET]: "This file holds secrets, such as a .env, and is never shown.",
  [TASK_FILE_REFUSAL.MISSING]: "There is no file at this path in the repository.",
  [TASK_FILE_REFUSAL.NOT_TEXT]: "This file is too large to show, or is not text.",
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "This task has no repository.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]:
    "The Luke GitHub App no longer reaches this task's repository.",
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read just now.",
} as const satisfies Record<TaskFileRefusal, string>;

/** The characters of a commit's SHA a line names it by, as GitHub abbreviates one. */
const SHORT_COMMIT_CHARS = 7;

/** A commit as a line names it: its SHA cut as GitHub abbreviates one. */
export function shortCommit(sha: string): string {
  return sha.slice(0, SHORT_COMMIT_CHARS);
}

/**
 * What a File tab says in place of a file refused: the table's line, and
 * for a missing file the branch it was looked for on where the service
 * named it, since the snippet was read from a checkout that held it, or
 * the commit it was read at, which an agent may not have pushed.
 */
export function refusalLine(
  refusal: TaskFileRefusal,
  branch: string | undefined,
  commit?: string,
): string {
  if (refusal === TASK_FILE_REFUSAL.MISSING && commit !== undefined) {
    return `This file is not at commit ${shortCommit(commit)} on GitHub, or the commit was never pushed.`;
  }
  if (refusal === TASK_FILE_REFUSAL.MISSING && branch !== undefined) {
    return `This file is not on ${branch}, the branch Luke reads from GitHub.`;
  }
  return FILE_REFUSAL_LINE[refusal];
}

/** Whether lines Luke showed are the lines a tab reads: any of his showings for a read of the default branch, and one read at the same commit for a read pinned to one. */
export function shownWhereRead(code: TaskCode, commit: string | undefined): boolean {
  return commit === undefined || code.commit === commit;
}

/**
 * The lines Luke showed of a File tab's file, which the tab draws where
 * the file itself cannot be: the newest showing of the lines the tab was
 * opened on, or else the newest of the file at all, of those read where
 * the tab reads.
 */
export function snippetOf(
  shown: readonly TaskCodeShowing[] | undefined,
  file: OpenFile,
): TaskCode | undefined {
  const ofFile = (shown ?? []).filter(
    (each) => each.code.ref.path === file.path && shownWhereRead(each.code, file.commit),
  );
  const opened = ofFile.findLast(
    ({ code: { ref } }) =>
      ref.startLine === file.range?.startLine && ref.endLine === file.range?.endLine,
  );
  return (opened ?? ofFile.at(-1))?.code;
}

/** A note Luke wrote on lines of a File tab's file as he showed them: the call that showed them and when, the lines, and his words. */
export interface FileNote {
  readonly callId: string;
  readonly shownAt: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly note: string;
}

/**
 * The notes Luke wrote on a File tab's file, one a range, in the file's
 * order: the newest showing of each range speaks for it, since the newer
 * note is the one he meant last. A showing of the whole file, one from
 * another repository or commit than the tab reads, and one from before
 * notes were asked for leave no note.
 */
export function notesOf(
  shown: readonly TaskCodeShowing[] | undefined,
  path: string,
  repository: string | null,
  commit: string | undefined,
): readonly FileNote[] {
  const notes: FileNote[] = [];
  for (const { callId, shownAt, code } of (shown ?? []).toReversed()) {
    const { startLine, endLine } = code.ref;
    if (code.ref.path !== path || code.note === undefined) continue;
    if (startLine === undefined || endLine === undefined) continue;
    if (repository !== null && code.repository !== repository) continue;
    if (!shownWhereRead(code, commit)) continue;
    if (notes.some((each) => each.startLine === startLine && each.endLine === endLine)) continue;
    notes.push({ callId, shownAt, startLine, endLine, note: code.note });
  }
  return notes.toSorted((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

/**
 * The file's page on GitHub at the commit its lines were read at, or the
 * branch where the service named no commit, so the page holds the lines
 * the tab draws; its lit lines marked where it still has them: a file
 * shortened past them, which the tab lights nothing of, opens at its top.
 */
export function fileUrl(held: FileLines, file: OpenFile): string {
  const page = `https://github.com/${held.repository}/blob/${githubPath(held.commit ?? held.branch)}/${githubPath(file.path)}`;
  if (file.range === undefined || file.range.startLine > held.lineCount) return page;
  const { startLine, endLine } = file.range;
  return startLine === endLine ? `${page}#L${startLine}` : `${page}#L${startLine}-L${endLine}`;
}

/** Whether a refusal may pass with time, so the tab offers to read again. */
export function refusalPasses(refusal: TaskFileRefusal): boolean {
  return refusal === TASK_FILE_REFUSAL.UNAVAILABLE;
}

/**
 * The window a line stands in: windows are counted from the file's first
 * line, each as long as one read carries, so the windows read above and
 * below one join it exactly.
 */
export function windowAt(line: number): FileWindow {
  const { WINDOW_LINES } = TASK_FILE_BOUNDS;
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
 * The window to read next for the whole file: the one just above the run
 * held, then the one just below it, while the file runs on past it; none
 * once the run is the whole file.
 */
export function windowUnread(held: FileLines): FileWindow | undefined {
  if (held.firstLine > 1) return windowAt(held.firstLine - 1);
  const last = lastLineOf(held);
  return last < held.lineCount ? windowAt(last + 1) : undefined;
}

/**
 * The run held with a window read laid beside it: the window just after
 * the run is joined below it, the one just before above it, one the run
 * already holds, read twice, leaves it as it was, and any other starts the
 * run afresh. The file's length is the newest read's, since the file is
 * read as it stands at each read.
 */
export function withWindow(held: FileRead, read: TaskFileShown): FileLines {
  const window: FileLines = {
    repository: read.repository,
    branch: read.branch,
    commit: read.commit,
    lineCount: read.lineCount,
    firstLine: read.firstLine,
    lines: read.lines,
  };
  // Note that lines read at another commit are never laid beside these, since they may be other lines.
  if (held.kind !== FILE_READ.READY || held.commit !== read.commit) return window;
  if (holdsLines(held, read.firstLine, read.firstLine + read.lines.length - 1)) {
    return { ...window, firstLine: held.firstLine, lines: held.lines };
  }
  if (read.firstLine === lastLineOf(held) + 1) {
    return { ...window, firstLine: held.firstLine, lines: [...held.lines, ...read.lines] };
  }
  if (read.firstLine + read.lines.length === held.firstLine) {
    return { ...window, lines: [...read.lines, ...held.lines] };
  }
  return window;
}

/** How a raw read of a file's whole text came out: the text, a file the service will not carry whole, or a read that did not land. */
export const WHOLE_TEXT = {
  READ: "read",
  REFUSED: "refused",
  UNREAD: "unread",
} as const;

export type WholeText =
  | { readonly kind: typeof WHOLE_TEXT.READ; readonly text: string }
  | { readonly kind: typeof WHOLE_TEXT.REFUSED }
  | { readonly kind: typeof WHOLE_TEXT.UNREAD };

/**
 * A raw read's answer as a copy or a download of the file hears it: the
 * file's text as it holds it, its lines uncut; a file the service refuses
 * to carry whole, as one grown past its bound since it was drawn; or a read
 * that did not land.
 */
export function wholeTextOf(answer: TasksFileAnswer): WholeText {
  if ("text" in answer) return { kind: WHOLE_TEXT.READ, text: answer.text.text };
  if ("refusal" in answer) return { kind: WHOLE_TEXT.REFUSED };
  return { kind: WHOLE_TEXT.UNREAD };
}
