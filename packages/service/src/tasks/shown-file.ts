import { isSecretFile, TASK_FILE_BOUNDS } from "@repo/features/task-wire";

export const SHOWN_FILE_REFUSAL = {
  SECRET: "secret",
  MISSING: "missing",
  NOT_TEXT: "not-text",
} as const;

export type ShownFileRefusal = (typeof SHOWN_FILE_REFUSAL)[keyof typeof SHOWN_FILE_REFUSAL];

export const SHOWN_FILE_BOUNDS = {
  MAX_FILE_BYTES: 1024 * 1024,
  TEXT_PROBE_BYTES: 8192,
} as const;

export interface ShownFileFacts {
  readonly path: string;
  readonly regular: boolean;
  readonly bytes: number;
  readonly binary: boolean;
}

export function holdsNul(bytes: Uint8Array): boolean {
  return bytes.subarray(0, SHOWN_FILE_BOUNDS.TEXT_PROBE_BYTES).includes(0);
}

export function shownFileRefusal(file: ShownFileFacts): ShownFileRefusal | undefined {
  if (isSecretFile(file.path)) return SHOWN_FILE_REFUSAL.SECRET;
  if (!file.regular) return SHOWN_FILE_REFUSAL.MISSING;
  if (file.bytes > SHOWN_FILE_BOUNDS.MAX_FILE_BYTES || file.binary) {
    return SHOWN_FILE_REFUSAL.NOT_TEXT;
  }
  return undefined;
}

export function fileLines(text: string): string[] {
  return text.split(/\r?\n/u);
}

export function shownLine(line: string): string {
  return line.slice(0, TASK_FILE_BOUNDS.MAX_LINE_CHARS);
}

export function shownLines(text: string, count: number): string[] {
  return fileLines(text).slice(0, count).map(shownLine);
}
