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
import { DIFF_SELECTION_SIDE, type DiffSelection } from "../diff-view/contract.js";
import {
  FILE_MARK,
  type FileMark,
  type FileMarkStatus,
  type FolderEntry,
  type ReadFolder,
} from "../file-tree/contract.js";

/**
 * changes-model.ts -- an agent's changes as its Files changed view draws them: each file's patch headed as a whole unified diff, or why it has none, which files a filter keeps and which start collapsed, and the lines a review thread is on as a patch of their own.
 *
 * A file's patch is the hunks of a unified diff from the first `@@` header
 * on, as GitHub sends it. It is drawn whole (`filePatch`), headed as git
 * writes one, by the diff bundle (`../diff-view/`), and copied or saved the
 * same way, so `git apply` takes it as it is. A file with no patch is never
 * drawn as unchanged: it says it is binary, too large to show, or, with an
 * empty patch, that its contents did not change.
 *
 * The view draws every file in one list, under a header of its own
 * (`listPatch` is the file's patch, or its header alone where it has no
 * hunks to draw), in the order the tree beside it lists them, folders
 * before files at each level, as Pierre's tree sorts them (`treeOrder`), so
 * a key stepping to the next file steps to the next row of the tree. A
 * filter keeps the files whose path holds what is typed,
 * whatever its case (`filterFiles`), as the tree's search narrows its rows.
 * A file starts collapsed, its header alone drawn, where reading it is
 * rarely the point, as GitHub keeps such a diff folded until asked
 * (`startsCollapsed`): one deleted, one changing more than
 * `LARGE_FILE_LINES` lines, and a package manager's lockfile, which GitHub
 * would mark generated.
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

/** The most lines a file may add and remove together before it starts collapsed. */
const LARGE_FILE_LINES = 1000;

/** The names of the lockfiles package managers write, which start collapsed wherever they stand. */
const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "go.sum",
  "Package.resolved",
  "flake.lock",
]);

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

/**
 * Each file's drawn lines, read once for the file as the changes answered
 * it, because the view asks again on every draw and a patch is parsed to
 * answer.
 */
const DRAWN_LINES = new WeakMap<CodingAgentChangedFile, DrawnLines>();

/** The lines a file's diff draws a row for, on each of GitHub's sides; none where it draws no hunks. */
function drawnLines(file: CodingAgentChangedFile): DrawnLines {
  const kept = DRAWN_LINES.get(file);
  if (kept !== undefined) return kept;
  const lines = linesDrawnBy(file);
  DRAWN_LINES.set(file, lines);
  return lines;
}

/** The lines a file's diff draws a row for, read off its patch. */
function linesDrawnBy(file: CodingAgentChangedFile): DrawnLines {
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
  const placed: PlacedThread[] = [];
  const above: PlacedThread[] = [];
  // Note that a file no thread is on reads none of its lines, which would parse its patch.
  if (!threads.some((thread) => thread.path === file.path)) return { placed, above };
  const lines = drawnLines(file);
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

/**
 * Each changed file's row mark in the tree: what became of it, the lines it
 * adds and removes, and, where Files changed knows them, how many review
 * threads stand on it, every one counted, resolved or not, as stage-cli's
 * tree counts them, and whether the member marked it viewed.
 */
export function changeMarks(
  files: readonly CodingAgentChangedFile[],
  beside: {
    readonly threads?: readonly ReviewThread[] | undefined;
    readonly viewed?: ((path: string) => boolean) | undefined;
  } = {},
): readonly FileMark[] {
  const threads = new Map<string, number>();
  for (const thread of beside.threads ?? []) {
    threads.set(thread.path, (threads.get(thread.path) ?? 0) + 1);
  }
  return files.map((file) => ({
    path: file.path,
    status: STATUS_MARK[file.status],
    lines: { additions: file.additions, deletions: file.deletions },
    threads: threads.get(file.path) ?? 0,
    viewed: beside.viewed?.(file.path),
  }));
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

/** A file's header as git writes one, with no hunks under it: what the list draws for a file whose place shows no lines. */
export function headerPatch(file: CodingAgentChangedFile): string {
  const from = file.previousPath ?? file.path;
  return [`diff --git a/${from} b/${file.path}`, `--- a/${from}`, `+++ b/${file.path}`, ""].join(
    "\n",
  );
}

/**
 * Each file's place in the list, spelled once for the file as the changes
 * answered it, so a draw of the list hands the bundle the very string it
 * was handed before, which it compares at once.
 */
const LIST_PATCHES = new WeakMap<CodingAgentChangedFile, string>();

/**
 * What a file's place in the list draws: its patch as a whole unified diff,
 * or, where it has no hunks to draw, its header alone (`headerPatch`), so
 * the file still stands in the list under its header, with why it has none
 * said there (`fileNotice`).
 */
export function listPatch(file: CodingAgentChangedFile): string {
  const kept = LIST_PATCHES.get(file);
  if (kept !== undefined) return kept;
  const patch = filePatch(file) ?? headerPatch(file);
  LIST_PATCHES.set(file, patch);
  return patch;
}

/** The files whose path holds `query`, whatever its case, as the tree's search narrows its rows; every file for a query of nothing but spaces. */

export function filterFiles(
  files: readonly CodingAgentChangedFile[],
  query: string,
): readonly CodingAgentChangedFile[] {
  const asked = query.trim().toLowerCase();
  if (asked === "") return files;
  return files.filter((file) => file.path.toLowerCase().includes(asked));
}

/** One step of a path as the tree sorts its rows: folders before files, a dotted name before the rest, then by name whatever its case. */
function compareStep(a: string, aFolder: boolean, b: string, bFolder: boolean): number {
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  const aDot = a.startsWith(".");
  if (aDot !== b.startsWith(".")) return aDot ? -1 : 1;
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

/** Two paths in the tree's order: at the first folder or name they part at, as `compareStep` sorts them. */
function compareTreePaths(a: string, b: string): number {
  const aSteps = a.split("/");
  const bSteps = b.split("/");
  for (let at = 0; at < Math.min(aSteps.length, bSteps.length); at += 1) {
    const aStep = aSteps[at] ?? "";
    const bStep = bSteps[at] ?? "";
    if (aStep === bStep) continue;
    return compareStep(aStep, at < aSteps.length - 1, bStep, at < bSteps.length - 1);
  }
  return aSteps.length - bSteps.length;
}

/** The files in the order the tree lists them, as Pierre's tree sorts its rows. */
export function treeOrder(
  files: readonly CodingAgentChangedFile[],
): readonly CodingAgentChangedFile[] {
  return files.toSorted((a, b) => compareTreePaths(a.path, b.path));
}

/** Whether a file starts collapsed: deleted, changing more than `LARGE_FILE_LINES` lines, or a lockfile. Note that a file with no hunks never does, because what stands under its header is why. */
export function startsCollapsed(file: CodingAgentChangedFile): boolean {
  if (fileNotice(file) !== undefined) return false;
  return (
    file.status === CHANGED_FILE_STATUS.DELETED ||
    file.additions + file.deletions > LARGE_FILE_LINES ||
    LOCKFILE_NAMES.has(file.path.split("/").at(-1) ?? "")
  );
}

/** The lines a comment is on, as GitHub takes them: its last line and the side it counts on, and, for more than one, its first and that one's side. */
export interface CommentLines {
  readonly line: number;
  readonly side: DiffSide;
  readonly startLine?: number;
  readonly startSide?: DiffSide;
}

/** A selection's side as GitHub's: the old side's lines on the left, the new side's on the right. */
const GITHUB_SIDE = {
  [DIFF_SELECTION_SIDE.DELETIONS]: DIFF_SIDE.LEFT,
  [DIFF_SELECTION_SIDE.ADDITIONS]: DIFF_SIDE.RIGHT,
} as const satisfies Record<DiffSelection["side"], DiffSide>;

/** Where a picked line stands among a file's hunks: which hunk, and which of its rows; none where no row stands for it. */
function rowAt(
  hunks: readonly DiffHunk[],
  side: DiffSelection["side"],
  line: number,
): { readonly hunk: number; readonly row: number } | undefined {
  for (const [hunk, { rows }] of hunks.entries()) {
    const row = rows.findIndex((each) =>
      side === DIFF_SELECTION_SIDE.DELETIONS
        ? each.kind !== DIFF_ROW.ADDED && each.oldLine === line
        : each.newLine === line,
    );
    if (row !== -1) return { hunk, row };
  }
  return undefined;
}

/**
 * The lines a comment picked in a file's diff is on, as GitHub takes them,
 * in the order the diff draws them, however the pick was dragged; one line
 * where both ends are the same row. None where GitHub would take no comment
 * there: a file that draws no hunks of its own, binary, too large, or an
 * image drawn in their place, a line no row of the diff stands for, or a
 * range whose ends stand in two hunks, which GitHub refuses.
 */
export function commentLines(
  file: CodingAgentChangedFile,
  picked: DiffSelection,
): CommentLines | undefined {
  if (fileNotice(file) !== undefined || file.patch === null) return undefined;
  const hunks = patchHunks(file.patch) ?? [];
  const from = rowAt(hunks, picked.side, picked.start);
  const to = rowAt(hunks, picked.endSide, picked.end);
  if (from === undefined || to === undefined || from.hunk !== to.hunk) return undefined;
  const [first, last] =
    from.row <= to.row
      ? [
          { line: picked.start, side: picked.side },
          { line: picked.end, side: picked.endSide },
        ]
      : [
          { line: picked.end, side: picked.endSide },
          { line: picked.start, side: picked.side },
        ];
  const end = { line: last.line, side: GITHUB_SIDE[last.side] };
  return from.row === to.row
    ? end
    : { ...end, startLine: first.line, startSide: GITHUB_SIDE[first.side] };
}

/** The lines a comment is on, as its composer names them: "line 12", or "lines 10–12" with each side's mark where the two ends count on different sides. */
export function commentLinesLabel(lines: CommentLines): string {
  const mark = (line: number, side: DiffSide) =>
    lines.startSide === undefined || lines.startSide === lines.side
      ? `${line}`
      : `${side === DIFF_SIDE.LEFT ? "L" : "R"}${line}`;
  if (lines.startLine === undefined) return `line ${lines.line}`;
  return `lines ${mark(lines.startLine, lines.startSide ?? lines.side)}–${mark(lines.line, lines.side)}`;
}
