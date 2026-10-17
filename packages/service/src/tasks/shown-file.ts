import { SHOWN_CODE_BOUNDS } from "@luke/features/task-wire";

/**
 * shown-file.ts -- the one rule a file of the task's repository is put on the developer's screen by, whichever reader read it.
 *
 * Two readers put a repository's lines on a Mac: `show_code`, from the
 * brain session's checkout (`show-code.ts`), and the File tab's read of
 * a whole file, from GitHub through the Luke GitHub App (`task-file.ts`).
 * Each finds out the same facts of a file in its own way, and both hand
 * them here, so what is refused and how a line is cut cannot drift between
 * them: a secret file is never read, only a regular file is shown, a file
 * past the size bound or holding a NUL among its first bytes is not text,
 * and every line travels cut to `SHOWN_CODE_BOUNDS.MAX_LINE_CHARS`.
 */

/** Why a file is not shown, whichever reader read it. */
export const SHOWN_FILE_REFUSAL = {
  /** A `.env` file, or one whose name starts with `.env`, wherever it sits. */
  SECRET: "secret",
  /** No regular file at the path: absent, a directory, or a link. */
  MISSING: "missing",
  /** Larger than the bound, or not text. */
  NOT_TEXT: "not-text",
} as const;

export type ShownFileRefusal = (typeof SHOWN_FILE_REFUSAL)[keyof typeof SHOWN_FILE_REFUSAL];

export const SHOWN_FILE_BOUNDS = {
  /** The largest file read at all; a larger one is said to be too large. */
  MAX_FILE_BYTES: 1024 * 1024,
  /** How many of a file's first bytes are looked at to tell text from binary. */
  TEXT_PROBE_BYTES: 8192,
} as const;

/** A file kept secret, refused wherever it sits in the repository. */
const SECRET_FILE = /(^|\/)\.env[^/]*$/u;

/** What a reader found out about a file before any of its lines leaves. */
export interface ShownFileFacts {
  readonly path: string;
  /** Whether the path names a regular file inside the repository, links followed only as far as the reader allows. */
  readonly regular: boolean;
  readonly bytes: number;
  /** Whether a NUL stands among the file's first `TEXT_PROBE_BYTES` bytes. */
  readonly binary: boolean;
}

/** Whether a path names a secret file, which no reader reads. */
export function isSecretFile(path: string): boolean {
  return SECRET_FILE.test(path);
}

/** Whether bytes hold a NUL among the first the text probe looks at. */
export function holdsNul(bytes: Uint8Array): boolean {
  return bytes.subarray(0, SHOWN_FILE_BOUNDS.TEXT_PROBE_BYTES).includes(0);
}

/** Why the file may not be shown, or nothing where it may. */
export function shownFileRefusal(file: ShownFileFacts): ShownFileRefusal | undefined {
  if (isSecretFile(file.path)) return SHOWN_FILE_REFUSAL.SECRET;
  if (!file.regular) return SHOWN_FILE_REFUSAL.MISSING;
  if (file.bytes > SHOWN_FILE_BOUNDS.MAX_FILE_BYTES || file.binary) {
    return SHOWN_FILE_REFUSAL.NOT_TEXT;
  }
  return undefined;
}

/** A file's lines, split on each newline, so a file has one more than its newlines, as the screen counts them. */
export function fileLines(text: string): string[] {
  return text.split(/\r?\n/u);
}

/** One line as it travels: cut to the bound. */
export function shownLine(line: string): string {
  return line.slice(0, SHOWN_CODE_BOUNDS.MAX_LINE_CHARS);
}

/** Lines of text as they travel: at most `count` of them, each cut to the bound. */
export function shownLines(text: string, count: number): string[] {
  return fileLines(text).slice(0, count).map(shownLine);
}
