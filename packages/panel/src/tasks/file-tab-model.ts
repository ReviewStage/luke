import { GITHUB_PAGE, gitHubPageLink } from "@repo/features/link-grammar";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@repo/features/task-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import type { OpenFile } from "./use-side-panel.js";

export const FILE_READ = {
  READING: "reading",
  READY: "ready",
  REFUSED: "refused",
  FAILED: "failed",
} as const;

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
      readonly branch: string | undefined;
    }
  | { readonly kind: typeof FILE_READ.FAILED };

const FILE_REFUSAL_LINE = {
  [TASK_FILE_REFUSAL.SECRET]: "This file holds secrets, such as a .env, and is never shown.",
  [TASK_FILE_REFUSAL.MISSING]: "There is no file at this path in the repository.",
  [TASK_FILE_REFUSAL.NOT_TEXT]: "This file is too large to show, or is not text.",
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "This task has no repository.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]: `${PRODUCT_NAME}'s GitHub App no longer reaches this task's repository.`,
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub could not be read.",
} as const satisfies Record<TaskFileRefusal, string>;

const SHORT_COMMIT_CHARS = 7;

export function shortCommit(sha: string): string {
  return sha.slice(0, SHORT_COMMIT_CHARS);
}

export function refusalLine(
  refusal: TaskFileRefusal,
  branch: string | undefined,
  commit?: string,
): string {
  if (refusal === TASK_FILE_REFUSAL.MISSING && commit !== undefined) {
    return `This file is not at commit ${shortCommit(commit)} on GitHub, or the commit was never pushed.`;
  }
  if (refusal === TASK_FILE_REFUSAL.MISSING && branch !== undefined) {
    return `This file is not on ${branch}, the branch ${PRODUCT_NAME} reads from GitHub.`;
  }
  return FILE_REFUSAL_LINE[refusal];
}

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

export function refusalPasses(refusal: TaskFileRefusal): boolean {
  return refusal === TASK_FILE_REFUSAL.UNAVAILABLE;
}

export function lineCountOf(text: string): number {
  const lines = text.split("\n").length;
  return text.endsWith("\n") && lines > 1 ? lines - 1 : lines;
}

export const WHOLE_TEXT = {
  READ: "read",
  REFUSED: "refused",
  UNREAD: "unread",
} as const;

export type WholeText =
  | { readonly kind: typeof WHOLE_TEXT.READ; readonly text: string }
  | { readonly kind: typeof WHOLE_TEXT.REFUSED; readonly cause: unknown }
  | { readonly kind: typeof WHOLE_TEXT.UNREAD; readonly cause: unknown };

export function wholeTextOf(answer: TasksFileAnswer): WholeText {
  if ("text" in answer) return { kind: WHOLE_TEXT.READ, text: answer.text.text };
  if ("refusal" in answer) return { kind: WHOLE_TEXT.REFUSED, cause: answer };
  return { kind: WHOLE_TEXT.UNREAD, cause: answer };
}
