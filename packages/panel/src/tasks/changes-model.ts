import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  type ChangedFileStatus,
  DIFF_SIDE,
  type DiffSide,
  PATCH_OMITTED,
  type ReviewThread,
} from "@repo/features/agent-wire";
import {
  DIFF_ROW,
  type DiffHunk,
  type DiffRow,
  type DiffRowKind,
  HUNK_COUNTS,
  LOCKFILE_NAMES,
  patchHunks,
} from "@repo/features/diff-hunks";
import { pullRequestAddressOf } from "@repo/features/link-grammar";
import { isSecretFile } from "@repo/features/task-wire";
import { repositoryParts } from "@repo/ui/task-list-model";
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

export const EXPANSION_REFUSAL = {
  NOT_TEXT: "not-text",
  CHANGED: "changed",
  UNAVAILABLE: "unavailable",
} as const;

export type ExpansionRefusal = (typeof EXPANSION_REFUSAL)[keyof typeof EXPANSION_REFUSAL];

export const EXPANSION_REFUSED_WORDS = {
  [EXPANSION_REFUSAL.NOT_TEXT]: "Cannot load more of this file: it's too large or not plain text.",
  [EXPANSION_REFUSAL.CHANGED]:
    "Cannot load more of this file: it changed since these changes were read.",
  [EXPANSION_REFUSAL.UNAVAILABLE]: "Cannot load more of this file just now.",
} as const satisfies Record<ExpansionRefusal, string>;

export const DIFF_LOAD_REFUSED_WORDS = {
  [EXPANSION_REFUSAL.NOT_TEXT]: "Cannot load its diff: it's too large or not plain text.",
  [EXPANSION_REFUSAL.CHANGED]: "Cannot load its diff: it changed since these changes were read.",
  [EXPANSION_REFUSAL.UNAVAILABLE]: "Cannot load its diff just now.",
} as const satisfies Record<ExpansionRefusal, string>;

export const STATUS_LETTER = {
  [CHANGED_FILE_STATUS.ADDED]: "A",
  [CHANGED_FILE_STATUS.MODIFIED]: "M",
  [CHANGED_FILE_STATUS.DELETED]: "D",
  [CHANGED_FILE_STATUS.RENAMED]: "R",
} as const;

const STATUS_MARK = {
  [CHANGED_FILE_STATUS.ADDED]: FILE_MARK.ADDED,
  [CHANGED_FILE_STATUS.MODIFIED]: FILE_MARK.MODIFIED,
  [CHANGED_FILE_STATUS.DELETED]: FILE_MARK.DELETED,
  [CHANGED_FILE_STATUS.RENAMED]: FILE_MARK.RENAMED,
} as const satisfies Record<ChangedFileStatus, FileMarkStatus>;

export const STATUS_WORDS = {
  [CHANGED_FILE_STATUS.ADDED]: "Added",
  [CHANGED_FILE_STATUS.MODIFIED]: "Modified",
  [CHANGED_FILE_STATUS.DELETED]: "Deleted",
  [CHANGED_FILE_STATUS.RENAMED]: "Renamed",
} as const satisfies Record<ChangedFileStatus, string>;

const NO_SIDE = "/dev/null";

const LARGE_FILE_LINES = 1000;

const THREAD_CONTEXT_ROWS = 3;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u;

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

function lineOn(row: DiffRow, side: DiffSide): number | undefined {
  return side === DIFF_SIDE.LEFT ? row.oldLine : row.newLine;
}

interface PreviewRows {
  readonly kept: readonly DiffRow[];
  readonly own: readonly DiffRow[];
}

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

const ROW_WRITTEN = {
  [DIFF_ROW.CONTEXT]: " ",
  [DIFF_ROW.ADDED]: "+",
  [DIFF_ROW.REMOVED]: "-",
  [DIFF_ROW.NOTE]: "\\",
} as const satisfies Record<DiffRowKind, string>;

function sideRange(numbers: readonly (number | undefined)[], before: number): string {
  const standing = numbers.filter((line) => line !== undefined);
  return `${standing[0] ?? before},${standing.length}`;
}

export interface ThreadPreview {
  readonly patch: string;
  readonly selected: DiffSelection | undefined;
}

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

interface PlacedThread {
  readonly thread: ReviewThread;
  readonly key: string;
  readonly side: DiffSelection["side"];
  readonly line: number;
}

export interface FileThreads {
  readonly placed: readonly PlacedThread[];
  readonly above: readonly PlacedThread[];
}

const SELECTION_SIDE = {
  [DIFF_SIDE.LEFT]: DIFF_SELECTION_SIDE.DELETIONS,
  [DIFF_SIDE.RIGHT]: DIFF_SELECTION_SIDE.ADDITIONS,
} as const satisfies Record<DiffSide, DiffSelection["side"]>;

interface DrawnLines {
  readonly [DIFF_SIDE.LEFT]: ReadonlySet<number>;
  readonly [DIFF_SIDE.RIGHT]: ReadonlySet<number>;
}

const DRAWN_LINES = new WeakMap<AgentChangedFile, DrawnLines>();

function drawnLines(file: AgentChangedFile): DrawnLines {
  const kept = DRAWN_LINES.get(file);
  if (kept !== undefined) return kept;
  const lines = linesDrawnBy(file);
  DRAWN_LINES.set(file, lines);
  return lines;
}

const WHOLE_LINES = new WeakMap<DiffFileTexts, DrawnLines>();

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

function linesDrawnBy(file: AgentChangedFile): DrawnLines {
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

function hunkEnds(patch: string): readonly { readonly old: number; readonly now: number }[] {
  const past = (start: number, count: number) => (count === 0 ? start + 1 : start + count);
  return (rawHunks(patch) ?? []).map((hunk) => ({
    old: past(hunk.oldStart, hunk.oldLines),
    now: past(hunk.newStart, hunk.newLines),
  }));
}

function gapLineOf(file: AgentChangedFile, side: DiffSide, line: number): number | undefined {
  if (side === DIFF_SIDE.RIGHT) return line;
  if (file.patch === null) return undefined;
  const before = hunkEnds(file.patch).findLast((end) => end.old <= line);
  return before === undefined ? line : line + before.now - before.old;
}

function openable(thread: ReviewThread): thread is ReviewThread & { readonly line: number } {
  return thread.line !== null && !thread.outdated;
}

export function gapLines(
  threads: readonly ReviewThread[],
  file: AgentChangedFile,
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

export function threadsOn(
  threads: readonly ReviewThread[],
  file: AgentChangedFile,
  whole?: DiffFileTexts | undefined,
  opened?: ReadonlySet<number> | undefined,
): FileThreads {
  const placed: PlacedThread[] = [];
  const above: PlacedThread[] = [];
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

export function fileNotice(file: AgentChangedFile): string | undefined {
  if (file.omitted !== null) return CHANGES_WORDS.OMITTED[file.omitted];
  if (file.patch === null) return CHANGES_WORDS.OMITTED[PATCH_OMITTED.TOO_LARGE];
  if (file.patch.trim() !== "") return undefined;
  return file.status === CHANGED_FILE_STATUS.RENAMED
    ? CHANGES_WORDS.UNCHANGED_CONTENTS
    : CHANGES_WORDS.NO_HUNKS;
}

export function changeMarks(
  files: readonly AgentChangedFile[],
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

function filePatch(file: AgentChangedFile): string | undefined {
  if (file.patch === null || fileNotice(file) !== undefined) return undefined;
  const from = file.previousPath ?? file.path;
  const before = file.status === CHANGED_FILE_STATUS.ADDED ? NO_SIDE : `a/${from}`;
  const after = file.status === CHANGED_FILE_STATUS.DELETED ? NO_SIDE : `b/${file.path}`;
  const body = file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`;
  return [`diff --git a/${from} b/${file.path}`, `--- ${before}`, `+++ ${after}`, body].join("\n");
}

export function pullRequestPatch(files: readonly AgentChangedFile[]): string | undefined {
  const patches = files.flatMap((file) => filePatch(file) ?? []);
  return patches.length === 0 ? undefined : patches.join("");
}

export function pullRequestPatchName(url: string): string {
  const address = pullRequestAddressOf(url);
  if (address === undefined) return "pull-request.patch";
  return `${repositoryParts(address.repository).name}-pr-${address.number}.patch`;
}

export function headerPatch(file: AgentChangedFile): string {
  const from = file.previousPath ?? file.path;
  return [`diff --git a/${from} b/${file.path}`, `--- a/${from}`, `+++ b/${file.path}`, ""].join(
    "\n",
  );
}

const LIST_PATCHES = new WeakMap<AgentChangedFile, string>();

export function listPatch(file: AgentChangedFile): string {
  const kept = LIST_PATCHES.get(file);
  if (kept !== undefined) return kept;
  const patch = filePatch(file) ?? headerPatch(file);
  LIST_PATCHES.set(file, patch);
  return patch;
}

export function filterFiles(
  files: readonly AgentChangedFile[],
  query: string,
): readonly AgentChangedFile[] {
  const asked = query.trim().toLowerCase();
  if (asked === "") return files;
  return files.filter((file) => file.path.toLowerCase().includes(asked));
}

function compareStep(a: string, aFolder: boolean, b: string, bFolder: boolean): number {
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  const aDot = a.startsWith(".");
  if (aDot !== b.startsWith(".")) return aDot ? -1 : 1;
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

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

export function treeOrder(files: readonly AgentChangedFile[]): readonly AgentChangedFile[] {
  return files.toSorted((a, b) => compareTreePaths(a.path, b.path));
}

export function startsCollapsed(file: AgentChangedFile): boolean {
  if (fileNotice(file) !== undefined) return false;
  return (
    file.status === CHANGED_FILE_STATUS.DELETED ||
    file.additions + file.deletions > LARGE_FILE_LINES ||
    LOCKFILE_NAMES.has(file.path.split("/").at(-1) ?? "")
  );
}

export interface CommentLines {
  readonly line: number;
  readonly side: DiffSide;
  readonly startLine?: number;
  readonly startSide?: DiffSide;
}

const GITHUB_SIDE = {
  [DIFF_SELECTION_SIDE.DELETIONS]: DIFF_SIDE.LEFT,
  [DIFF_SELECTION_SIDE.ADDITIONS]: DIFF_SIDE.RIGHT,
} as const satisfies Record<DiffSelection["side"], DiffSide>;

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

export function commentLines(
  file: AgentChangedFile,
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

export function commentLinesLabel(lines: CommentLines): string {
  const mark = (line: number, side: DiffSide) =>
    lines.startSide === undefined || lines.startSide === lines.side
      ? `${line}`
      : `${side === DIFF_SIDE.LEFT ? "L" : "R"}${line}`;
  if (lines.startLine === undefined) return `line ${lines.line}`;
  return `lines ${mark(lines.startLine, lines.startSide ?? lines.side)}–${mark(lines.line, lines.side)}`;
}

function linesOf(text: string) {
  const endsInNewline = text.endsWith("\n");
  const body = endsInNewline ? text.slice(0, -1) : text;
  return {
    lines: body === "" && endsInNewline ? [""] : body === "" ? [] : body.split("\n"),
    endsInNewline,
  };
}

interface RawHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

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
    if (line === "") continue;
    hunk.lines.push(line);
  }
  return hunks;
}

export async function blobShaOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const whole = new Uint8Array(header.length + bytes.length);
  whole.set(header);
  whole.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", whole));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function expandable(file: AgentChangedFile): boolean {
  const changedInPlace =
    file.status === CHANGED_FILE_STATUS.MODIFIED || file.status === CHANGED_FILE_STATUS.RENAMED;
  return changedInPlace && fileNotice(file) === undefined && !isSecretFile(file.path);
}

function movedOnly(file: AgentChangedFile): boolean {
  return file.status === CHANGED_FILE_STATUS.RENAMED && file.patch?.trim() === "";
}

export function wholeable(file: AgentChangedFile): boolean {
  return expandable(file) || (movedOnly(file) && !isSecretFile(file.path));
}

export function tooLargeToDiff(file: AgentChangedFile): boolean {
  return file.omitted === PATCH_OMITTED.TOO_LARGE && !isSecretFile(file.path);
}

export function textsOf(file: AgentChangedFile, after: string): DiffFileTexts | undefined {
  if (movedOnly(file) && wholeable(file)) return { before: after, after };
  const patch = file.patch;
  if (!expandable(file) || patch === null) return undefined;
  const hunks = rawHunks(patch);
  if (hunks === undefined) return undefined;
  const { lines, endsInNewline } = linesOf(after);
  const before: string[] = [];
  let at = 0;
  let beforeUnended = false;
  let afterOnlyUnended = false;
  for (const hunk of hunks) {
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

export function suggestedLines(file: AgentChangedFile, lines: CommentLines): string | undefined {
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

export function rowPlace(
  file: AgentChangedFile,
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
