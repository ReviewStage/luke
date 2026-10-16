import {
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
  type CodingAgentChangedFile,
  PATCH_OMITTED,
} from "@luke/features/coding-agent-wire";
import { parsePatch } from "diff";
import {
  FILE_MARK,
  type FileMark,
  type FileMarkStatus,
  type FolderEntry,
  type ReadFolder,
} from "../file-tree/contract";

/**
 * changes-model.ts -- an agent's changes as its Changes tab draws them: each file's patch as a unified diff's rows, numbered on both sides, or why it has none.
 *
 * A file's patch is the hunks of a unified diff from the first `@@` header
 * on, as GitHub sends it. The hunks are jsdiff's (`parsePatch`, the library
 * the plan's own merges already use), which counts each hunk's lines by its
 * header, so a removed line whose own text starts with dashes is still one
 * removed line. Each line of a hunk is a row numbered on the side it stands
 * on: a removed line on the old side alone, an added line on the new side
 * alone, and a line of context on both. A file with no patch is never drawn
 * as unchanged: it says it is binary, too large to show, or, with an empty
 * patch, that its contents did not change.
 *
 * The tab draws its files in a File tab's tree and breadcrumbs, which list
 * a folder at a time: the folders here are listed from the changed paths
 * alone (`changedFolders`), so either shows only what changed, each file
 * marked as an editor's source control marks it (`changeMarks`). A file's
 * patch is copied or saved as a whole unified diff (`filePatch`), headed
 * as git writes one, so `git apply` takes it as it is.
 */

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

/** The kind of row each mark starts in a patch; a line of context starts with a space. */
const ROW_MARK = new Map<string, DiffRowKind>([
  ["+", DIFF_ROW.ADDED],
  ["-", DIFF_ROW.REMOVED],
  ["\\", DIFF_ROW.NOTE],
]);

/** What the tab says where the changes cannot be drawn. */
export const CHANGES_WORDS = {
  READING: "Reading changes",
  FAILED: "The changes could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  EMPTY: "This pull request changes no files.",
  TRUNCATED: "Only the first files are shown; this pull request has more.",
  OMITTED: {
    [PATCH_OMITTED.BINARY]: "Binary file not shown.",
    [PATCH_OMITTED.TOO_LARGE]: "This file's diff is too large to show.",
  },
  UNCHANGED_CONTENTS: "File renamed without changes to its contents.",
  NO_HUNKS: "No changes to show in this file.",
  UNREADABLE: "This file's diff could not be read.",
} as const;

/** The letter a file wears for what became of it, as an editor's source control marks it. */
export const STATUS_LETTER = {
  [CHANGED_FILE_STATUS.ADDED]: "A",
  [CHANGED_FILE_STATUS.MODIFIED]: "M",
  [CHANGED_FILE_STATUS.DELETED]: "D",
  [CHANGED_FILE_STATUS.RENAMED]: "R",
} as const;

/** What each status marks a file's row in the tree with. */
const STATUS_MARK = {
  [CHANGED_FILE_STATUS.ADDED]: FILE_MARK.ADDED,
  [CHANGED_FILE_STATUS.MODIFIED]: FILE_MARK.MODIFIED,
  [CHANGED_FILE_STATUS.DELETED]: FILE_MARK.DELETED,
  [CHANGED_FILE_STATUS.RENAMED]: FILE_MARK.RENAMED,
} as const satisfies Record<ChangedFileStatus, FileMarkStatus>;

/** What the letter a file wears says in words, in its hint. */
export const STATUS_WORDS = {
  [CHANGED_FILE_STATUS.ADDED]: "Added",
  [CHANGED_FILE_STATUS.MODIFIED]: "Modified",
  [CHANGED_FILE_STATUS.DELETED]: "Deleted",
  [CHANGED_FILE_STATUS.RENAMED]: "Renamed",
} as const satisfies Record<ChangedFileStatus, string>;

/** Where git's diff names a side the file does not stand on: before it was added, or after it was deleted. */
const NO_SIDE = "/dev/null";

/** One hunk's lines as rows, each numbered on the side it stands on, counting from where the hunk starts. */
function rowsOf(lines: readonly string[], oldStart: number, newStart: number): DiffRow[] {
  let oldLine = oldStart;
  let newLine = newStart;
  return lines.map((line) => {
    const kind = ROW_MARK.get(line.charAt(0)) ?? DIFF_ROW.CONTEXT;
    const text = line.slice(1);
    if (kind === DIFF_ROW.NOTE) return { kind, oldLine: undefined, newLine: undefined, text };
    if (kind === DIFF_ROW.ADDED) return { kind, oldLine: undefined, newLine: newLine++, text };
    if (kind === DIFF_ROW.REMOVED) return { kind, oldLine: oldLine++, newLine: undefined, text };
    return { kind, oldLine: oldLine++, newLine: newLine++, text };
  });
}

/**
 * A patch's hunks, or none where it does not read as a unified diff. Note
 * that each hunk's header is taken from the patch as written, because
 * jsdiff keeps only its numbers and git writes the enclosing scope after
 * them; a hunk's own lines start with a mark or a space, so the lines that
 * start with `@@` are its headers, in order.
 */
export function patchHunks(patch: string): readonly DiffHunk[] | undefined {
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(patch);
  } catch {
    return undefined;
  }
  const headers = patch.split("\n").filter((line) => line.startsWith("@@"));
  return (parsed[0]?.hunks ?? []).map((hunk, index) => ({
    header: headers[index] ?? "",
    rows: rowsOf(hunk.lines, hunk.oldStart, hunk.newStart),
  }));
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

/** Each changed file's row mark in the tree. */
export function changeMarks(files: readonly CodingAgentChangedFile[]): readonly FileMark[] {
  return files.map((file) => ({ path: file.path, status: STATUS_MARK[file.status] }));
}

/** The lines every file adds and removes, summed. */
export function linesChanged(files: readonly CodingAgentChangedFile[]) {
  return {
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

/**
 * The folders the changed paths stand in, each listed as the tree lists a
 * folder of the repository: the entries of its own that hold a change, a
 * folder for each one deeper, a file for each changed file; a folder
 * holding no change lists nothing.
 */
export function changedFolders(paths: readonly string[]): ReadFolder {
  const folders = new Map<string, Map<string, boolean>>();
  for (const path of paths) {
    const segments = path.split("/");
    segments.forEach((name, at) => {
      const folder = segments.slice(0, at).join("/");
      const entries = folders.get(folder) ?? new Map<string, boolean>();
      folders.set(folder, entries);
      entries.set(name, entries.get(name) === true || at < segments.length - 1);
    });
  }
  return (path) => {
    const entries: FolderEntry[] = [...(folders.get(path) ?? [])].map(([name, folder]) => ({
      name,
      folder,
    }));
    return Promise.resolve({ entries, truncated: false });
  };
}

/**
 * A file's patch as a whole unified diff, headed as git writes one: the
 * paths on each side, `/dev/null` for a side it does not stand on; none
 * where the file carries no hunks to copy.
 */
export function filePatch(file: CodingAgentChangedFile): string | undefined {
  if (file.patch === null || fileNotice(file) !== undefined) return undefined;
  const from = file.previousPath ?? file.path;
  const before = file.status === CHANGED_FILE_STATUS.ADDED ? NO_SIDE : `a/${from}`;
  const after = file.status === CHANGED_FILE_STATUS.DELETED ? NO_SIDE : `b/${file.path}`;
  const body = file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`;
  return [`diff --git a/${from} b/${file.path}`, `--- ${before}`, `+++ ${after}`, body].join("\n");
}
