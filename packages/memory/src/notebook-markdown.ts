import { maximumRememberedFactLength, rememberedFactText } from "@sidecar/acts";
import { WORKSPACE_FILE } from "@sidecar/runtime";

/**
 * The notebook's canonical shape inside the Markdown files. A remembered
 * fact about the developer is one bullet line in USER.md under a fixed
 * heading; the file stays human-readable and editable, and what the store
 * keeps beside it — the entry's id, its origin, the fact id it was migrated
 * from — is provenance about a line, never the line itself. The line's
 * normalized words are its identity in the file: an id maps to words, and
 * words appear once.
 */

export const NOTEBOOK_FILE = {
  USER: WORKSPACE_FILE.USER,
  MEMORY: WORKSPACE_FILE.MEMORY,
} as const;

export type NotebookFile = (typeof NOTEBOOK_FILE)[keyof typeof NOTEBOOK_FILE];

/** The evergreen files at the notebook's root: indexed whole, never aged, read by relative path. */
export const NOTEBOOK_ROOT_FILES: readonly NotebookFile[] = Object.values(NOTEBOOK_FILE);

export function isNotebookRootFile(relativePath: string): boolean {
  const files: readonly string[] = NOTEBOOK_ROOT_FILES;
  return files.includes(relativePath);
}

/** The heading remembered facts live under in USER.md; text above it is the developer's own. */
export const REMEMBERED_HEADING = "## Remembered";

const BULLET_RE = /^\s*[-*]\s+(.*\S)\s*$/u;

/** One flattening and bound for a fact's words: the acts package's, the same one a remember act applies at the door. */
export const maximumNotebookEntryLength = maximumRememberedFactLength;

export function notebookEntryText(value: string): string | undefined {
  return rememberedFactText(value);
}

export interface ParsedNotebookEntry {
  readonly words: string;
  /** One-based line number in the file. */
  readonly line: number;
}

export interface ParsedNotebook {
  readonly entries: readonly ParsedNotebookEntry[];
  /** Whether the remembered heading stands in the file. */
  readonly hasHeading: boolean;
}

/**
 * The bullet lines under the remembered heading, up to the next heading of
 * the same or a higher level. A bullet elsewhere in the file is the
 * developer's own prose and is not an entry.
 */
export function parseNotebook(content: string): ParsedNotebook {
  const lines = content.split("\n");
  const entries: ParsedNotebookEntry[] = [];
  let inSection = false;
  let hasHeading = false;
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    if (line === REMEMBERED_HEADING) {
      inSection = true;
      hasHeading = true;
      return;
    }
    if (inSection && /^#{1,2}\s/u.test(line)) {
      inSection = false;
      return;
    }
    if (!inSection) return;
    const match = BULLET_RE.exec(line);
    const words = match?.[1] ? notebookEntryText(match[1]) : undefined;
    if (words) entries.push({ words, line: index + 1 });
  });
  return { entries, hasHeading };
}

/** The file with `words` appended as an entry under the heading, which is added at the end when missing. */
export function appendNotebookEntry(content: string, words: string): string {
  const parsed = parseNotebook(content);
  const bullet = `- ${words}`;
  if (!parsed.hasHeading) {
    const base = content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
    return `${base}${base.length > 0 ? "\n" : ""}${REMEMBERED_HEADING}\n\n${bullet}\n`;
  }
  const lines = content.split("\n");
  const last = parsed.entries[parsed.entries.length - 1];
  const headingIndex = lines.findIndex((line) => line.trimEnd() === REMEMBERED_HEADING);
  const insertAfter = last ? last.line - 1 : headingIndex;
  lines.splice(insertAfter + 1, 0, bullet);
  return lines.join("\n");
}

/** The file with the entry line carrying `words` removed, or unchanged when no such entry stands. */
export function removeNotebookEntry(content: string, words: string): string {
  const parsed = parseNotebook(content);
  const entry = parsed.entries.find((candidate) => candidate.words === words);
  if (!entry) return content;
  const lines = content.split("\n");
  lines.splice(entry.line - 1, 1);
  return lines.join("\n");
}
