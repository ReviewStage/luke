import {
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
  type CodingAgentChangedFile,
  DIFF_SIDE,
  type DiffSide,
  PATCH_OMITTED,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import {
  DIFF_ROW,
  type DiffHunk,
  type DiffRow,
  type DiffRowKind,
  HUNK_COUNTS,
  LOCKFILE_NAMES,
  patchHunks,
} from "@luke/features/diff-hunks";
import { isSecretFile } from "@luke/features/task-wire";
import {
  DIFF_SELECTION_SIDE,
  type DiffFileTexts,
  type DiffSelection,
} from "../diff-view/contract.js";
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
 * the other. The hunk's lines are read as every patch here is
 * (`patchHunks`, from `@luke/features/diff-hunks`), counted by the header,
 * so a removed line whose own text starts with dashes is still one removed
 * line; the rows kept are written again as a patch of their own, its header
 * counting them, with the thread's own lines selected.
 *
 * A review thread on a line of the head no hunk shows stands above the
 * diff until a gap opened over its line draws it, and on that line from then
 * on (`gapLines`, `threadsOn`); an outdated one stands above whatever is
 * opened, its line being on an older commit.
 *
 * A comment on lines of the head alone may suggest a change to them, which
 * starts from those lines as the file's patch holds them (`suggestedLines`).
 */

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

/** Why a changed file's lines between its hunks could not be opened: not read as text, read but not the text its patch was made against, or not read at all just now. */
export const EXPANSION_REFUSAL = {
  NOT_TEXT: "not-text",
  CHANGED: "changed",
  UNAVAILABLE: "unavailable",
} as const;

export type ExpansionRefusal = (typeof EXPANSION_REFUSAL)[keyof typeof EXPANSION_REFUSAL];

/** What a file whose lines between hunks could not be opened says, once, above its first hunk. */
export const EXPANSION_REFUSED_WORDS = {
  [EXPANSION_REFUSAL.NOT_TEXT]: "Can't load more of this file: it's too large or not plain text.",
  [EXPANSION_REFUSAL.CHANGED]:
    "Can't load more of this file: it changed since these changes were read.",
  [EXPANSION_REFUSAL.UNAVAILABLE]: "Can't load more of this file just now.",
} as const satisfies Record<ExpansionRefusal, string>;

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

/** How many rows a review thread's preview shows above the first line it is on. */
const THREAD_CONTEXT_ROWS = 3;

/** A hunk's header: where it starts on each side, what it counts, and the scope git writes after. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u;

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

/** Each whole file's lines, counted once for its texts. */
const WHOLE_LINES = new WeakMap<DiffFileTexts, DrawnLines>();

/** The lines a file drawn whole draws a row for: every line of each side's text. */
function wholeLines(whole: DiffFileTexts): DrawnLines {
  const kept = WHOLE_LINES.get(whole);
  if (kept !== undefined) return kept;
  const numbered = (text: string) => new Set(linesOf(text).lines.map((_line, index) => index + 1));
  const lines = {
    [DIFF_SIDE.LEFT]: numbered(whole.before),
    [DIFF_SIDE.RIGHT]: numbered(whole.after),
  };
  WHOLE_LINES.set(whole, lines);
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
 * Where each line after a hunk stands on the new side: the first old line
 * past each hunk and the first new one, in order, every unchanged line
 * after it counted on from there until the next hunk.
 */
function hunkEnds(patch: string): readonly { readonly old: number; readonly now: number }[] {
  // A side a hunk holds no line of names the line before its place, as a patch does.
  const past = (start: number, count: number) => (count === 0 ? start + 1 : start + count);
  return (rawHunks(patch) ?? []).map((hunk) => ({
    old: past(hunk.oldStart, hunk.oldLines),
    now: past(hunk.newStart, hunk.newLines),
  }));
}

/**
 * The new side's line a line between a file's hunks stands on, as Pierre
 * counts the lines a gap opens: a line of the new side as it is, and one of
 * the old side counted on by what the hunks before it added and removed,
 * since every line between hunks is the same on both sides. None where the
 * file draws no patch.
 */
function gapLineOf(file: CodingAgentChangedFile, side: DiffSide, line: number): number | undefined {
  if (side === DIFF_SIDE.RIGHT) return line;
  if (file.patch === null) return undefined;
  const before = hunkEnds(file.patch).findLast((end) => end.old <= line);
  return before === undefined ? line : line + before.now - before.old;
}

/** Whether a thread may stand on a line a gap opened: one standing on a line of the head now, not outdated. */
function openable(thread: ReviewThread): thread is ReviewThread & { readonly line: number } {
  return thread.line !== null && !thread.outdated;
}

/**
 * The lines of the new side between a file's hunks its review threads
 * stand on, in ascending order, which the list is asked to tell of as a
 * gap opens over them (`threadsOn`'s `opened`): every thread on a line of
 * the head its patch draws no row for, not outdated, its old side's line
 * counted on to the new side's (`gapLineOf`). None on a file whose patch
 * is not drawn.
 */
export function gapLines(
  threads: readonly ReviewThread[],
  file: CodingAgentChangedFile,
): readonly number[] {
  const own = threads.filter(
    (thread): thread is ReviewThread & { readonly line: number } =>
      thread.path === file.path && openable(thread),
  );
  if (own.length === 0 || fileNotice(file) !== undefined) return [];
  const lines = drawnLines(file);
  const hidden = new Set<number>();
  for (const thread of own) {
    if (lines[thread.side].has(thread.line)) continue;
    const gap = gapLineOf(file, thread.side, thread.line);
    if (gap !== undefined) hidden.add(gap);
  }
  return [...hidden].toSorted((a, b) => a - b);
}

/**
 * A file's review threads as Files changed draws them, as GitHub's own
 * diff does: each on the line it stands on now, under that line on the
 * side it counts on, where the file's diff draws a row for that line, or
 * where a gap it opened draws that line (`opened`, lines of the new side,
 * as `gapLines` names them); and, at the top of the diff, in the order the
 * pull request holds them, those it draws none for: a thread whose line a
 * later push took away, outdated, which no opened gap draws; one on a line
 * no hunk shows; and every one on a file whose diff is not drawn, binary,
 * too large, or empty. A file drawn whole draws a row for every one of its
 * lines, so its threads stand on any of them. Each is keyed by its first
 * comment's page, which no other thread shares; one with no comment is
 * drawn nowhere.
 */
export function threadsOn(
  threads: readonly ReviewThread[],
  file: CodingAgentChangedFile,
  /** The file's texts where it is drawn whole; none where it draws its patch. */
  whole?: DiffFileTexts | undefined,
  /** The lines of the new side between its hunks the file draws now, its gaps opened over them. */
  opened?: ReadonlySet<number> | undefined,
): FileThreads {
  const placed: PlacedThread[] = [];
  const above: PlacedThread[] = [];
  // Note that a file no thread is on reads none of its lines, which would parse its patch.
  if (!threads.some((thread) => thread.path === file.path)) return { placed, above };
  const lines = whole === undefined ? drawnLines(file) : wholeLines(whole);
  const inGap = (thread: ReviewThread) => {
    if (opened === undefined || opened.size === 0 || !openable(thread)) return false;
    const gap =
      fileNotice(file) === undefined ? gapLineOf(file, thread.side, thread.line) : undefined;
    return gap !== undefined && opened.has(gap);
  };
  for (const thread of threads) {
    const key = thread.comments[0]?.url;
    if (thread.path !== file.path || key === undefined) continue;
    const side = SELECTION_SIDE[thread.side];
    const line = thread.line;
    if (line !== null && (lines[thread.side].has(line) || inGap(thread))) {
      placed.push({ thread, key, side, line });
    } else above.push({ thread, key, side, line: line ?? thread.originalLine ?? 0 });
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

/** A text's lines, and whether its last line ends in a newline, as a patch counts them. */
function linesOf(text: string) {
  const endsInNewline = text.endsWith("\n");
  const body = endsInNewline ? text.slice(0, -1) : text;
  return {
    lines: body === "" && endsInNewline ? [""] : body === "" ? [] : body.split("\n"),
    endsInNewline,
  };
}

/** A hunk of a patch as written: where it starts and how many lines it holds on each side, and its lines, each with its mark. */
interface RawHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

/**
 * A patch's hunks as written, each line split at its newline alone, so a
 * line ending in a carriage return keeps it, as the file's own text does;
 * none for a patch that does not read as hunks.
 */
function rawHunks(patch: string): readonly RawHunk[] | undefined {
  const hunks: {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }[] = [];
  for (const line of patch.split("\n")) {
    const header = HUNK_COUNTS.exec(line);
    if (header !== null) {
      const [, oldStart = "", oldLines = "1", newStart = "", newLines = "1"] = header;
      hunks.push({
        oldStart: Number(oldStart),
        oldLines: Number(oldLines),
        newStart: Number(newStart),
        newLines: Number(newLines),
        lines: [],
      });
      continue;
    }
    const hunk = hunks.at(-1);
    if (hunk === undefined) return line === "" ? hunks : undefined;
    // Note that a line of a hunk always starts with its mark, so an empty one is the patch's end.
    if (line === "") continue;
    hunk.lines.push(line);
  }
  return hunks;
}

/**
 * The name git gives a file's contents, its blob: the SHA-1 of its header
 * and its bytes, which GitHub names each changed file's contents after by
 * (`CodingAgentChangedFile.blobSha`).
 */
export async function blobShaOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const whole = new Uint8Array(header.length + bytes.length);
  whole.set(header);
  whole.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", whole));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether a file's lines between its hunks can be drawn: a file changed in place or moved with changes, whose patch is drawn, and that is no secret file. */
export function expandable(file: CodingAgentChangedFile): boolean {
  const changedInPlace =
    file.status === CHANGED_FILE_STATUS.MODIFIED || file.status === CHANGED_FILE_STATUS.RENAMED;
  // Note that a secret file is never read whole, so its gaps are never offered.
  return changedInPlace && fileNotice(file) === undefined && !isSecretFile(file.path);
}

/** Whether a file only moved, its contents as they were: a rename whose patch holds no hunk. */
function movedOnly(file: CodingAgentChangedFile): boolean {
  return file.status === CHANGED_FILE_STATUS.RENAMED && file.patch?.trim() === "";
}

/** Whether a file can be drawn whole: one whose gaps open (`expandable`), or one that only moved, all of whose lines stand unchanged; never a secret one. */
export function wholeable(file: CodingAgentChangedFile): boolean {
  return expandable(file) || (movedOnly(file) && !isSecretFile(file.path));
}

/**
 * A changed file's whole text before and after, from its text after alone
 * and its patch: every line no hunk holds is the same on both sides, so the
 * text before is the text after with each hunk turned back, its context and
 * removed lines kept and its added lines dropped. None where the text after
 * is not the one the patch was made against, any hunk's context or added
 * lines differing from the text at its place, because the lines between
 * hunks would then be drawn from another commit; and none for a file
 * whose lines between hunks are not drawn (`expandable`).
 */
export function textsOf(file: CodingAgentChangedFile, after: string): DiffFileTexts | undefined {
  // A file that only moved stood before as it stands now.
  if (movedOnly(file) && wholeable(file)) return { before: after, after };
  const patch = file.patch;
  if (!expandable(file) || patch === null) return undefined;
  const hunks = rawHunks(patch);
  if (hunks === undefined) return undefined;
  const { lines, endsInNewline } = linesOf(after);
  const before: string[] = [];
  let at = 0;
  // Which side a "No newline at end of file" marker followed: the text before's last line, or the text after's alone.
  let beforeUnended = false;
  let afterOnlyUnended = false;
  for (const hunk of hunks) {
    // A hunk adding nothing names the line before its place, as a patch does.
    const start = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
    if (start < at || start > lines.length) return undefined;
    before.push(...lines.slice(at, start));
    const beforeStart = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (before.length !== beforeStart) return undefined;
    at = start;
    let previous = " ";
    for (const line of hunk.lines) {
      const mark = line.slice(0, 1);
      const text = line.slice(1);
      if (mark === "\\") {
        if (previous === "+") afterOnlyUnended = true;
        else beforeUnended = true;
        continue;
      }
      if (mark !== "-") {
        if (lines[at] !== text) return undefined;
        at += 1;
      }
      if (mark !== "+") before.push(text);
      previous = mark;
    }
  }
  before.push(...lines.slice(at));
  const text = before.join("\n");
  const beforeEndsInNewline = beforeUnended ? false : afterOnlyUnended ? true : endsInNewline;
  return { before: beforeEndsInNewline && before.length > 0 ? `${text}\n` : text, after };
}

/**
 * The lines a comment is on as they read at the head, for a suggestion to
 * start from: the new side's words of each line from its first to its
 * last, as the file's patch holds them. None where either end counts on
 * the old side, whose lines a suggestion cannot change, or where the patch
 * holds no row for one of the lines.
 */
export function suggestedLines(
  file: CodingAgentChangedFile,
  lines: CommentLines,
): string | undefined {
  const first = lines.startLine ?? lines.line;
  const sides = [lines.side, lines.startSide ?? lines.side];
  if (file.patch === null || sides.some((side) => side !== DIFF_SIDE.RIGHT)) return undefined;
  const hunk = (patchHunks(file.patch) ?? []).find(({ rows }) =>
    rows.some((row) => row.newLine === lines.line),
  );
  const rows = (hunk?.rows ?? []).filter(
    (row) => row.newLine !== undefined && row.newLine >= first && row.newLine <= lines.line,
  );
  if (rows.length !== lines.line - first + 1) return undefined;
  return rows.map((row) => row.text).join("\n");
}

/**
 * Where a line of a file stands in the order its diff draws its rows: its
 * row's place among every hunk's rows, the old side's line found among the
 * rows that hold it, as a pick's ends are (`commentLines`); none for a line
 * no row stands for.
 */
export function rowPlace(
  file: CodingAgentChangedFile,
  side: DiffSelection["side"],
  line: number,
): number | undefined {
  if (file.patch === null) return undefined;
  const rows = (patchHunks(file.patch) ?? []).flatMap((hunk) => hunk.rows);
  const at = rows.findIndex((row) =>
    side === DIFF_SELECTION_SIDE.DELETIONS
      ? row.kind !== DIFF_ROW.ADDED && row.oldLine === line
      : row.newLine === line,
  );
  return at === -1 ? undefined : at;
}
