import {
  CHANGED_FILE_STATUS,
  CHANGES_UNAVAILABLE,
  type ChangesUnavailable,
  type CodingAgentChangedFile,
  type CodingAgentChangeSet,
  PATCH_OMITTED,
} from "@sidecar/hosted/coding-agent-wire";

/**
 * changes-model.ts -- an agent's changes as a Changes tab draws them: where its read stands, and each file's patch as a unified diff's rows, numbered on both sides.
 *
 * The tab draws a change set whatever source read it: a list of changed
 * files, each with its patch, the hunks of a unified diff from the first
 * `@@` header on, or a word saying why it carries none. A patch is cut
 * into hunks, each headed by its own `@@` line, and each line of a hunk is
 * a row numbered on the side it stands on: a removed line on the old side
 * alone, an added line on the new side alone, and a line of context on
 * both, each count starting where the hunk's header says. A file with no
 * patch is never drawn as unchanged: it says it is binary, too large to
 * show, or, with an empty patch, that its contents did not change.
 */

/** Where a read of the changes stands: out, landed with a change set, landed with none to read yet, or failed. */
export const CHANGES_READ = {
  READING: "reading",
  READY: "ready",
  UNAVAILABLE: "unavailable",
  FAILED: "failed",
} as const;

export type ChangesRead =
  | { readonly kind: typeof CHANGES_READ.READING }
  | { readonly kind: typeof CHANGES_READ.READY; readonly changes: CodingAgentChangeSet }
  | { readonly kind: typeof CHANGES_READ.UNAVAILABLE; readonly why: ChangesUnavailable }
  | { readonly kind: typeof CHANGES_READ.FAILED };

/** What one row of a hunk is: a line of context, one added, one removed, or git's note on the line above it. */
export const DIFF_ROW = {
  CONTEXT: "context",
  ADDED: "added",
  REMOVED: "removed",
  NOTE: "note",
} as const;

type DiffRowKind = (typeof DIFF_ROW)[keyof typeof DIFF_ROW];

/** One row of a hunk: what it is, its line number on each side it stands on, and its text without the mark before it. */
interface DiffRow {
  readonly kind: DiffRowKind;
  readonly oldLine: number | undefined;
  readonly newLine: number | undefined;
  readonly text: string;
}

/** One hunk: its `@@` header as written, and its rows. */
export interface DiffHunk {
  readonly header: string;
  readonly rows: readonly DiffRow[];
}

/** A hunk's header: where each side's lines start, and the words after it git takes from the enclosing scope. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The mark each kind of row starts with in a patch. */
const ROW_MARK = { ADDED: "+", REMOVED: "-", NOTE: "\\" } as const;

/** What the tab says where the changes cannot be drawn. */
export const CHANGES_WORDS = {
  READING: "Reading changes",
  FAILED: "The changes could not be read.",
  EMPTY: "This pull request changes no files.",
  TRUNCATED: "Only the first files are shown; this change set has more.",
  UNAVAILABLE: {
    [CHANGES_UNAVAILABLE.NO_PULL_REQUEST]:
      "No pull request yet. Its changes show here once the agent opens one.",
  } satisfies Record<ChangesUnavailable, string>,
  OMITTED: {
    [PATCH_OMITTED.BINARY]: "Binary file not shown.",
    [PATCH_OMITTED.TOO_LARGE]: "This file's diff is too large to show.",
  },
  UNCHANGED_CONTENTS: "File renamed without changes to its contents.",
  NO_HUNKS: "No changes to show in this file.",
} as const;

/** The letter a file's row wears for what became of it, as an editor's source control marks it. */
export const STATUS_LETTER = {
  [CHANGED_FILE_STATUS.ADDED]: "A",
  [CHANGED_FILE_STATUS.MODIFIED]: "M",
  [CHANGED_FILE_STATUS.DELETED]: "D",
  [CHANGED_FILE_STATUS.RENAMED]: "R",
} as const;

/**
 * A patch's hunks, each line a row numbered on the side it stands on.
 * Lines ahead of the first header, which a patch should not have, are
 * passed over; a header that does not read starts its count from one.
 */
export function patchHunks(patch: string): readonly DiffHunk[] {
  const hunks: { header: string; rows: DiffRow[] }[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (line.startsWith("@@")) {
      oldLine = header === null ? 1 : Number(header[1]);
      newLine = header === null ? 1 : Number(header[2]);
      hunks.push({ header: line, rows: [] });
      continue;
    }
    const hunk = hunks.at(-1);
    if (hunk === undefined) continue;
    const mark = line.slice(0, 1);
    const text = line.slice(1);
    if (mark === ROW_MARK.ADDED) {
      hunk.rows.push({ kind: DIFF_ROW.ADDED, oldLine: undefined, newLine, text });
      newLine += 1;
    } else if (mark === ROW_MARK.REMOVED) {
      hunk.rows.push({ kind: DIFF_ROW.REMOVED, oldLine, newLine: undefined, text });
      oldLine += 1;
    } else if (mark === ROW_MARK.NOTE) {
      hunk.rows.push({ kind: DIFF_ROW.NOTE, oldLine: undefined, newLine: undefined, text });
    } else {
      hunk.rows.push({ kind: DIFF_ROW.CONTEXT, oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

/**
 * What a file's pane says in its patch's place, or nothing where it draws
 * its hunks: why it carries no patch, that a file only moved kept its
 * contents, or that a patch holds no hunk.
 */
export function fileNotice(file: CodingAgentChangedFile): string | undefined {
  if (file.omitted !== null) return CHANGES_WORDS.OMITTED[file.omitted];
  if (file.patch === null) return CHANGES_WORDS.OMITTED[PATCH_OMITTED.TOO_LARGE];
  if (file.patch.trim() !== "") return undefined;
  return file.status === CHANGED_FILE_STATUS.RENAMED
    ? CHANGES_WORDS.UNCHANGED_CONTENTS
    : CHANGES_WORDS.NO_HUNKS;
}

/** The lines a change set adds and removes, every file's together. */
export function changeTotals(files: readonly CodingAgentChangedFile[]): {
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

/** The file the pane shows: the one chosen, while the change set still holds it, else the first. */
export function chosenFile(
  files: readonly CodingAgentChangedFile[],
  chosen: string | undefined,
): CodingAgentChangedFile | undefined {
  return files.find((file) => file.path === chosen) ?? files[0];
}

/** "1 file" or "12 files". */
export function fileCountLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}
