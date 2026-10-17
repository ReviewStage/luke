import {
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
  type CodingAgentChangedFile,
  DIFF_SIDE,
  type DiffSide,
  PATCH_OMITTED,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { parsePatch } from "diff";
import { DIFF_SELECTION_SIDE, type DiffSelection } from "../diff-view/contract";
import {
  FILE_MARK,
  type FileMark,
  type FileMarkStatus,
  type FolderEntry,
  type ReadFolder,
} from "../file-tree/contract";

/**
 * changes-model.ts -- an agent's changes as its Files changed view draws them: each file's patch headed as a whole unified diff, or why it has none, and the lines a review thread is on as a patch of their own.
 *
 * A file's patch is the hunks of a unified diff from the first `@@` header
 * on, as GitHub sends it. It is drawn whole (`filePatch`), headed as git
 * writes one, by the diff bundle (`../diff-view/`), and copied or saved the
 * same way, so `git apply` takes it as it is. A file with no patch is never
 * drawn as unchanged: it says it is binary, too large to show, or, with an
 * empty patch, that its contents did not change.
 *
 * The view draws its files in a File tab's tree and breadcrumbs, which list
 * a folder at a time: the folders here are listed from the changed paths
 * alone (`changedFolders`), so either shows only what changed, each file
 * marked as an editor's source control marks it (`changeMarks`).
 *
 * A review thread on the pull request's overview previews the lines it is
 * on through the same diff bundle (`threadPreview`): GitHub freezes the
 * hunk a thread was made on, from the hunk's start to the thread's line, so
 * the preview is the end of that hunk, from a few rows above the first line
 * the thread is on down to its last, counted where the thread was made
 * rather than where it stands now, since a later push moves the one and not
 * the other. The hunk's lines are read by jsdiff (`parsePatch`), which
 * counts them by the header, so a removed line whose own text starts with
 * dashes is still one removed line; the rows kept are written again as a
 * patch of their own, its header counting them, with the thread's own lines
 * selected.
 */

/** What one row of a hunk is: a line of context, one added, one removed, or git's note on the line above it. */
const DIFF_ROW = {
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
interface DiffHunk {
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
  TOO_NARROW_TO_SPLIT: "Needs a wider panel",
  UNPLACED_THREADS: "Comments on lines this diff does not show",
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

/** How many rows a review thread's preview shows above the first line it is on. */
const THREAD_CONTEXT_ROWS = 3;

/** A hunk's header: where it starts on each side, what it counts, and the scope git writes after. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u;

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
function patchHunks(patch: string): readonly DiffHunk[] | undefined {
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
 * A hunk GitHub froze for a review thread, its header counting the lines it
 * holds; none where it does not start with a header. Note that the header
 * is counted again, because GitHub keeps the whole hunk's counts while
 * cutting its lines at the thread's line, and jsdiff refuses a hunk whose
 * lines fall short of its header.
 */
function frozenHunk(diffHunk: string): string | undefined {
  const [header = "", ...written] = diffHunk.split("\n");
  const match = HUNK_HEADER.exec(header);
  if (match === null) return undefined;
  const lines = written.at(-1) === "" ? written.slice(0, -1) : written;
  const old = lines.filter((line) => !line.startsWith("+") && !line.startsWith("\\")).length;
  const now = lines.filter((line) => !line.startsWith("-") && !line.startsWith("\\")).length;
  const [, oldStart = "", newStart = "", scope = ""] = match;
  return [`@@ -${oldStart},${old} +${newStart},${now} @@${scope}`, ...lines].join("\n");
}

/** A row's number on the side given, none where it does not stand on that side. */
function lineOn(row: DiffRow, side: DiffSide): number | undefined {
  return side === DIFF_SIDE.LEFT ? row.oldLine : row.newLine;
}

/** The rows a review thread previews, and those of them its own range holds. */
interface PreviewRows {
  readonly kept: readonly DiffRow[];
  readonly own: readonly DiffRow[];
}

/** The rows a review thread previews, the end of the hunk from a few rows above its range to its line, and those of its range. */
function previewRows(
  rows: readonly DiffRow[],
  thread: Pick<ReviewThread, "originalLine" | "originalStartLine" | "side" | "startSide">,
): PreviewRows {
  const { originalLine: line, originalStartLine: startLine, side } = thread;
  const found = rows.findLastIndex((row) => line !== null && lineOn(row, side) === line);
  const end = found === -1 ? rows.length - 1 : found;
  const startSide = thread.startSide ?? side;
  const first = rows.findIndex(
    (row, at) => at <= end && startLine !== null && lineOn(row, startSide) === startLine,
  );
  const start = first === -1 ? end : first;
  return {
    kept: rows.slice(Math.max(0, start - THREAD_CONTEXT_ROWS), end + 1),
    own: rows.slice(start, end + 1),
  };
}

/** Where a row stands in a unified diff's selection: a removed line on the old side, any other on the new. */
function selectionPoint(row: DiffRow): { line: number; side: DiffSelection["side"] } | undefined {
  if (row.kind === DIFF_ROW.REMOVED) {
    return row.oldLine === undefined
      ? undefined
      : { line: row.oldLine, side: DIFF_SELECTION_SIDE.DELETIONS };
  }
  return row.newLine === undefined
    ? undefined
    : { line: row.newLine, side: DIFF_SELECTION_SIDE.ADDITIONS };
}

/** The mark a row is written with in a patch. */
const ROW_WRITTEN = {
  [DIFF_ROW.CONTEXT]: " ",
  [DIFF_ROW.ADDED]: "+",
  [DIFF_ROW.REMOVED]: "-",
  [DIFF_ROW.NOTE]: "\\",
} as const satisfies Record<DiffRowKind, string>;

/** One side's start and count in a hunk's header, for its line numbers among the rows, at `before` where it holds none. */
function sideRange(numbers: readonly (number | undefined)[], before: number): string {
  const standing = numbers.filter((line) => line !== undefined);
  return `${standing[0] ?? before},${standing.length}`;
}

/** A review thread's preview: the lines it is on as a patch of their own, and the thread's own lines selected in it. */
export interface ThreadPreview {
  readonly patch: string;
  readonly selected: DiffSelection | undefined;
}

/**
 * What a review thread previews: the end of the hunk GitHub froze for it,
 * from a few rows above the first line of its range to its line, each found
 * on the side it counts on, the hunk's last row where its line is not
 * found, since GitHub ends the hunk there; written as a patch of the
 * thread's file, its header counting the rows kept, with the thread's own
 * lines selected. None where the hunk is empty or does not read as a diff.
 */
export function threadPreview(
  thread: Pick<
    ReviewThread,
    "path" | "diffHunk" | "originalLine" | "originalStartLine" | "side" | "startSide"
  >,
): ThreadPreview | undefined {
  const hunk = frozenHunk(thread.diffHunk);
  if (hunk === undefined) return undefined;
  const parsed = patchHunks(hunk)?.at(-1);
  const rows = parsed?.rows ?? [];
  const { kept, own } = previewRows(rows, thread);
  const first = kept[0];
  if (parsed === undefined || first === undefined) return undefined;
  const before = rows.slice(0, rows.indexOf(first));
  // A side the kept rows hold no line of is written at the last line before them, as git writes an empty side.
  const oldBefore = before.findLast((row) => row.oldLine !== undefined)?.oldLine ?? 0;
  const newBefore = before.findLast((row) => row.newLine !== undefined)?.newLine ?? 0;
  const scope = HUNK_HEADER.exec(parsed.header)?.[3] ?? "";
  const oldRange = sideRange(
    kept.map((row) => row.oldLine),
    oldBefore,
  );
  const newRange = sideRange(
    kept.map((row) => row.newLine),
    newBefore,
  );
  const header = `@@ -${oldRange} +${newRange} @@${scope}`;
  const patch = [
    `diff --git a/${thread.path} b/${thread.path}`,
    `--- a/${thread.path}`,
    `+++ b/${thread.path}`,
    header,
    ...kept.map((row) => `${ROW_WRITTEN[row.kind]}${row.text}`),
    "",
  ].join("\n");
  const ownFirst = own[0];
  const ownLast = own.at(-1);
  const start = ownFirst === undefined ? undefined : selectionPoint(ownFirst);
  const end = ownLast === undefined ? undefined : selectionPoint(ownLast);
  const selected =
    start === undefined || end === undefined
      ? undefined
      : { start: start.line, side: start.side, end: end.line, endSide: end.side };
  return { patch, selected };
}

/** A review thread drawn on its line in Files changed: the thread, its key, and the line it stands under on the side it counts on. */
interface PlacedThread {
  readonly thread: ReviewThread;
  readonly key: string;
  readonly side: DiffSelection["side"];
  readonly line: number;
}

/** A file's review threads: those drawn on their lines, and those drawn above its diff, which it has no row for. */
export interface FileThreads {
  readonly placed: readonly PlacedThread[];
  readonly above: readonly PlacedThread[];
}

/** The side of a diff each of GitHub's sides is counted on: the old side's lines on the left, the new side's on the right. */
const SELECTION_SIDE = {
  [DIFF_SIDE.LEFT]: DIFF_SELECTION_SIDE.DELETIONS,
  [DIFF_SIDE.RIGHT]: DIFF_SELECTION_SIDE.ADDITIONS,
} as const satisfies Record<DiffSide, DiffSelection["side"]>;

/** The lines a file's diff draws a row for, on each of GitHub's sides. */
interface DrawnLines {
  readonly [DIFF_SIDE.LEFT]: ReadonlySet<number>;
  readonly [DIFF_SIDE.RIGHT]: ReadonlySet<number>;
}

/** The lines a file's diff draws a row for, on each of GitHub's sides; none where it draws no hunks. */
function drawnLines(file: CodingAgentChangedFile): DrawnLines {
  const patch = fileNotice(file) === undefined ? file.patch : null;
  const rows = patch === null ? [] : (patchHunks(patch) ?? []).flatMap((hunk) => hunk.rows);
  return {
    [DIFF_SIDE.LEFT]: new Set(
      rows.flatMap((row) => (row.oldLine === undefined ? [] : [row.oldLine])),
    ),
    [DIFF_SIDE.RIGHT]: new Set(
      rows.flatMap((row) => (row.newLine === undefined ? [] : [row.newLine])),
    ),
  };
}

/**
 * A file's review threads as Files changed draws them, as GitHub's own
 * diff does: each on the line it stands on now, under that line on the
 * side it counts on, where the file's diff draws a row for that line; and,
 * at the top of the diff, in the order the pull request holds them, those
 * it draws none for: a thread whose line a later push took away, outdated;
 * one on a line no hunk shows; and every one on a file whose diff is not
 * drawn, binary, too large, or empty. Each is keyed by its first comment's
 * page, which no other thread shares; one with no comment is drawn nowhere.
 */
export function threadsOn(
  threads: readonly ReviewThread[],
  file: CodingAgentChangedFile,
): FileThreads {
  const lines = drawnLines(file);
  const placed: PlacedThread[] = [];
  const above: PlacedThread[] = [];
  for (const thread of threads) {
    const key = thread.comments[0]?.url;
    if (thread.path !== file.path || key === undefined) continue;
    const side = SELECTION_SIDE[thread.side];
    const line = thread.line;
    if (line !== null && lines[thread.side].has(line)) placed.push({ thread, key, side, line });
    else above.push({ thread, key, side, line: line ?? thread.originalLine ?? 0 });
  }
  return { placed, above };
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
