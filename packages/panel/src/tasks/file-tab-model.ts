import { GITHUB_PAGE, gitHubPageLink } from "@luke/features/link-grammar";
import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@luke/features/task-wire";
import type { TasksFileAnswer } from "@luke/features/tasks-view";
import type { OpenFile } from "./use-side-panel.js";

/**
 * file-tab-model.ts -- what a File tab holds of its file, apart from drawing it: its whole text, where it was read, and why a file is not shown.
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

/** A file's whole text, of `lineCount` lines, read on `branch`, at `commit` where the service named the commit. */
export interface FileText {
  readonly repository: string;
  readonly branch: string;
  readonly commit: string | undefined;
  readonly lineCount: number;
  readonly text: string;
}

export type FileRead =
  | { readonly kind: typeof FILE_READ.READING }
  | ({ readonly kind: typeof FILE_READ.READY } & FileText)
  | {
      readonly kind: typeof FILE_READ.REFUSED;
      readonly refusal: TaskFileRefusal;
      /** The branch GitHub found nothing at the path on, where the service named it. */
      readonly branch: string | undefined;
    }
  | { readonly kind: typeof FILE_READ.FAILED };

/** What a File tab says in its file's place, for each reason the file is not shown. */
const FILE_REFUSAL_LINE = {
  [TASK_FILE_REFUSAL.SECRET]: "This file holds secrets, such as a .env, and is never shown.",
  [TASK_FILE_REFUSAL.MISSING]: "There is no file at this path in the repository.",
  [TASK_FILE_REFUSAL.NOT_TEXT]: "This file is too large to show, or is not text.",
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "This task has no repository.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]: "Luke's GitHub App no longer reaches this task's repository.",
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read.",
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
 * named it, or the commit it was read at, which an agent may not have
 * pushed.
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

/**
 * The file's page on GitHub at the commit its lines were read at, or the
 * branch where the service named no commit, so the page holds the lines
 * the tab draws; its lit lines marked where it still has them: a file
 * shortened past them, which the tab lights nothing of, opens at its top.
 */
export function fileUrl(held: FileText, file: OpenFile): string {
  const page = {
    kind: GITHUB_PAGE.FILE,
    repository: held.repository,
    ref: held.commit ?? held.branch,
    path: file.path,
  } as const;
  if (file.range === undefined || file.range.startLine > held.lineCount) {
    return gitHubPageLink(page);
  }
  const { startLine, endLine } = file.range;
  return gitHubPageLink({ ...page, lines: { startLine, endLine } });
}

/** Whether a refusal may pass with time, so the tab offers to read again. */
export function refusalPasses(refusal: TaskFileRefusal): boolean {
  return refusal === TASK_FILE_REFUSAL.UNAVAILABLE;
}

/**
 * How many lines a file's text holds, as GitHub and an editor count them:
 * a newline ending the last line opens no line of its own, and an empty
 * file holds one empty line.
 */
export function lineCountOf(text: string): number {
  const lines = text.split("\n").length;
  return text.endsWith("\n") && lines > 1 ? lines - 1 : lines;
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
