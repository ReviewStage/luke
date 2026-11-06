import { Schema as EffectSchema } from "effect";
import ignore from "ignore";
import type { AgentChangedFile, ReviewThread } from "./agent-wire.js";
import { DIFF_SIDE } from "./agent-wire.js";
import { DIFF_ROW, type DiffHunk, LOCKFILE_NAMES, patchHunks } from "./diff-hunks.js";

export const CHAPTER_KIND = {
  STORY: "story",
  OTHER: "other",
} as const;

export const LINE_REF_SIDE = {
  ADDITIONS: "additions",
  DELETIONS: "deletions",
} as const;

type LineRefSide = (typeof LINE_REF_SIDE)[keyof typeof LINE_REF_SIDE];

export const CHAPTER_RISK = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export const HEADER_ONLY_OLD_START = 0;

export const hunkRefSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  oldStart: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(HEADER_ONLY_OLD_START)),
});

export type HunkRef = typeof hunkRefSchema.Type;

const lineNumberSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

export const lineRefSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  side: EffectSchema.Literals(Object.values(LINE_REF_SIDE)),
  startLine: lineNumberSchema,
  endLine: lineNumberSchema,
}).check(EffectSchema.makeFilter((ref) => ref.startLine <= ref.endLine));

export type LineRef = typeof lineRefSchema.Type;

export const keyChangeSchema = EffectSchema.Struct({
  content: EffectSchema.String,
  lineRefs: EffectSchema.Array(lineRefSchema),
});

export const chapterSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(CHAPTER_KIND)),
  title: EffectSchema.String,
  summary: EffectSchema.String,
  hunkRefs: EffectSchema.Array(hunkRefSchema),
  keyChanges: EffectSchema.Array(keyChangeSchema),
  risk: EffectSchema.NullOr(EffectSchema.Literals(Object.values(CHAPTER_RISK))),
  riskReasons: EffectSchema.Array(EffectSchema.String),
});

export type Chapter = typeof chapterSchema.Type;

export interface ChapterHunk {
  readonly ref: HunkRef;
  readonly hunk: DiffHunk | null;
}

function fileHunks(file: AgentChangedFile): readonly DiffHunk[] {
  if (file.omitted !== null || file.patch === null) return [];
  return patchHunks(file.patch) ?? [];
}

export function chapterHunks(files: readonly AgentChangedFile[]): readonly ChapterHunk[] {
  return files.flatMap((file): readonly ChapterHunk[] => {
    const hunks = fileHunks(file);
    if (hunks.length === 0) {
      return [{ ref: { path: file.path, oldStart: HEADER_ONLY_OLD_START }, hunk: null }];
    }
    return hunks.map((hunk) => ({ ref: { path: file.path, oldStart: hunk.oldStart }, hunk }));
  });
}

type HunkIndex = ReadonlyMap<string, ReadonlyMap<number, ChapterHunk>>;

function indexHunks(hunks: readonly ChapterHunk[]): HunkIndex {
  const index = new Map<string, Map<number, ChapterHunk>>();
  for (const each of hunks) {
    const starts = index.get(each.ref.path) ?? new Map<number, ChapterHunk>();
    index.set(each.ref.path, starts);
    if (!starts.has(each.ref.oldStart)) starts.set(each.ref.oldStart, each);
  }
  return index;
}

function chapterOwnHunks(chapter: Chapter, index: HunkIndex): readonly ChapterHunk[] {
  const seen = new Set<ChapterHunk>();
  for (const ref of chapter.hunkRefs) {
    const found = index.get(ref.path)?.get(ref.oldStart);
    if (found !== undefined) seen.add(found);
  }
  return [...seen];
}

const IGNORE_PATTERNS: readonly string[] = [
  ...LOCKFILE_NAMES,
  ".DS_Store",
  "Thumbs.db",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.snap",
  "*.svg",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp4",
  "*.webm",
  "*.pdf",
  "**/migrations/*/snapshot.json",
  "**/meta/*_snapshot.json",
];

const IGNORED = ignore({ ignoreCase: true }).add([...IGNORE_PATTERNS]);

export function ignoredForChapters(path: string): boolean {
  return IGNORED.ignores(path);
}

export interface CoveredChapters {
  readonly chapters: readonly Chapter[];
  readonly missing: readonly HunkRef[];
}

export function coverHunks(
  chapters: readonly Chapter[],
  hunks: readonly ChapterHunk[],
): CoveredChapters {
  const index = indexHunks(hunks);
  const placed = new Set<ChapterHunk>();
  const covered = chapters.flatMap((chapter) => {
    const own = chapterOwnHunks(chapter, index).filter((each) => !placed.has(each));
    for (const each of own) placed.add(each);
    return own.length === 0 ? [] : [{ ...chapter, hunkRefs: own.map((each) => each.ref) }];
  });
  const missing = hunks.filter((each) => !placed.has(each)).map((each) => each.ref);
  return { chapters: covered, missing };
}

const OTHER_CHANGES_TITLE = "Other changes";

const OTHER_CHANGES_SUMMARY =
  "Lockfiles, generated files, binary assets, pure renames, and any change no chapter told.";

export function otherChangesChapter(refs: readonly HunkRef[]): Chapter {
  return {
    kind: CHAPTER_KIND.OTHER,
    title: OTHER_CHANGES_TITLE,
    summary: OTHER_CHANGES_SUMMARY,
    hunkRefs: refs,
    keyChanges: [],
    risk: null,
    riskReasons: [],
  };
}

function sideSpan(hunk: DiffHunk, side: LineRefSide): { first: number; last: number } {
  return side === LINE_REF_SIDE.ADDITIONS
    ? { first: hunk.newStart, last: hunk.newStart + hunk.newLines - 1 }
    : { first: hunk.oldStart, last: hunk.oldStart + hunk.oldLines - 1 };
}

function sameLines(a: LineRef, b: LineRef): boolean {
  return (
    a.path === b.path && a.side === b.side && a.startLine === b.startLine && a.endLine === b.endLine
  );
}

export function validLineRefs(chapter: Chapter, hunks: readonly ChapterHunk[]): Chapter {
  const own = chapterOwnHunks(chapter, indexHunks(hunks));
  const inChapter = (ref: LineRef) =>
    own.some(({ ref: hunkRef, hunk }) => {
      if (hunk === null || hunkRef.path !== ref.path) return false;
      const { first, last } = sideSpan(hunk, ref.side);
      return first <= last && ref.startLine >= first && ref.endLine <= last;
    });
  const keyChanges = chapter.keyChanges.flatMap((change) => {
    const kept: LineRef[] = [];
    for (const ref of change.lineRefs) {
      if (ref.startLine < 1 || ref.startLine > ref.endLine || !inChapter(ref)) continue;
      if (!kept.some((each) => sameLines(each, ref))) kept.push(ref);
    }
    return kept.length === 0 ? [] : [{ content: change.content, lineRefs: kept }];
  });
  return { ...chapter, keyChanges };
}

function hunkTexts(patch: string): readonly string[] {
  const texts: string[][] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) texts.push([line]);
    else texts.at(-1)?.push(line);
  }
  return texts.map((lines) => lines.join("\n"));
}

interface LineCounts {
  readonly additions: number;
  readonly deletions: number;
}

function hunkCounts(hunk: DiffHunk): LineCounts {
  return {
    additions: hunk.rows.filter((row) => row.kind === DIFF_ROW.ADDED).length,
    deletions: hunk.rows.filter((row) => row.kind === DIFF_ROW.REMOVED).length,
  };
}

export function chapterPatches(
  chapter: Chapter,
  files: readonly AgentChangedFile[],
): readonly AgentChangedFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const wanted = new Map<string, Set<number>>();
  for (const ref of chapter.hunkRefs) {
    if (!byPath.has(ref.path)) continue;
    const starts = wanted.get(ref.path) ?? new Set<number>();
    wanted.set(ref.path, starts);
    starts.add(ref.oldStart);
  }
  return [...wanted].flatMap(([path, starts]) => {
    const file = byPath.get(path);
    if (file === undefined) return [];
    const hunks = fileHunks(file);
    if (hunks.length === 0) return starts.has(HEADER_ONLY_OLD_START) ? [file] : [];
    const kept = hunks.flatMap((hunk, at) => (starts.has(hunk.oldStart) ? [at] : []));
    if (kept.length === hunks.length) return [file];
    if (kept.length === 0 || file.patch === null) return [];
    const texts = hunkTexts(file.patch);
    const counts = kept.map((at) => hunks[at]).filter((hunk) => hunk !== undefined);
    return [
      {
        ...file,
        patch: kept.map((at) => texts[at] ?? "").join("\n"),
        additions: counts.reduce((sum, hunk) => sum + hunkCounts(hunk).additions, 0),
        deletions: counts.reduce((sum, hunk) => sum + hunkCounts(hunk).deletions, 0),
      },
    ];
  });
}

function within(line: number, start: number, count: number): boolean {
  return line >= start && line < start + count;
}

export function threadInChapter(
  thread: Pick<ReviewThread, "path" | "line" | "originalLine" | "side">,
  chapter: Chapter,
  hunks: readonly ChapterHunk[],
): boolean {
  const own = chapterOwnHunks(chapter, indexHunks(hunks)).filter(
    (each) => each.ref.path === thread.path,
  );
  if (thread.line === null && thread.originalLine === null) return own.length > 0;
  return own.some(({ hunk }) => {
    if (hunk === null) return true;
    if (thread.line === null) {
      return (
        thread.originalLine !== null && within(thread.originalLine, hunk.oldStart, hunk.oldLines)
      );
    }
    return thread.side === DIFF_SIDE.LEFT
      ? within(thread.line, hunk.oldStart, hunk.oldLines)
      : within(thread.line, hunk.newStart, hunk.newLines);
  });
}

interface ChapterCounts extends LineCounts {
  readonly files: number;
}

export function chapterLineCounts(
  chapter: Chapter,
  files: readonly AgentChangedFile[],
): ChapterCounts {
  const drawn = chapterPatches(chapter, files);
  return {
    additions: drawn.reduce((sum, file) => sum + file.additions, 0),
    deletions: drawn.reduce((sum, file) => sum + file.deletions, 0),
    files: drawn.length,
  };
}

const ESCAPED_NEWLINE = /```[\s\S]*?```|``[\s\S]*?``|`[^`]*`|\\n/gu;

export function unescapeLiteralNewlines(text: string): string {
  return text.replace(ESCAPED_NEWLINE, (match) => {
    if (match.startsWith("```")) return match.replaceAll("\\n", "\n");
    if (match.startsWith("`")) return match;
    return "\n";
  });
}
