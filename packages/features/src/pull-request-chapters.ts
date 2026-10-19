import { Schema as EffectSchema } from "effect";
import type { CodingAgentChangedFile, ReviewThread } from "./coding-agent-wire.js";
import { DIFF_SIDE } from "./coding-agent-wire.js";
import { DIFF_ROW, type DiffHunk, LOCKFILE_NAMES, patchHunks } from "./diff-hunks.js";

/**
 * pull-request-chapters.ts -- a pull request's diff told as chapters: what one is on the wire, and the checks that hold a model's chapters to the diff they tell.
 *
 * A chapter is one step of the story a pull request tells, in the order a
 * reviewer should read it: a title, a short summary in Markdown, the hunks
 * it holds, the changes a reviewer should weigh in it (`KeyChange`), each
 * on lines of its own hunks, and how risky it is and why. The last chapter
 * may be "Other changes", told by no model (`otherChangesChapter`): the
 * files a reader reads past (`ignoredForChapters`), those with no hunk to
 * read, and any hunk the model left out. It is named by its `kind` rather
 * than its title, because a model may title a chapter of its own the same.
 *
 * A hunk is named by its git coordinates, its file and the line it starts
 * at on the old side (`HunkRef`), as ReviewStage names one; `oldStart` 0
 * names a file with no hunks, a pure rename, a binary file, or one whose
 * patch was left out (`HEADER_ONLY_OLD_START`). A hunk adding a file starts
 * at 0 too, which names it alone, since that file has a hunk.
 *
 * A model's answer is held to the diff in code, never trusted: every hunk
 * stands in exactly one chapter (`coverHunks`), as stage-cli's coverage
 * check holds an agent's, a key change points only at lines of its own
 * chapter's hunks (`validLineRefs`), and literal `\n` a model escaped twice
 * is read as the newline it meant (`unescapeLiteralNewlines`). What a
 * chapter draws is its own hunks out of each file's patch
 * (`chapterPatches`), with the review threads on them (`threadInChapter`)
 * and the lines they change (`chapterLineCounts`).
 */

/** What a chapter is: a step of the story a model told, or the fixed "Other changes" chapter that closes it. */
export const CHAPTER_KIND = {
  STORY: "story",
  OTHER: "other",
} as const;

/** Which file a line reference counts in: the new file's lines, where it adds, or the old file's, where it removes. */
export const LINE_REF_SIDE = {
  ADDITIONS: "additions",
  DELETIONS: "deletions",
} as const;

type LineRefSide = (typeof LINE_REF_SIDE)[keyof typeof LINE_REF_SIDE];

/** How risky a chapter is to merge unread. */
export const CHAPTER_RISK = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

/** The old-side start that names a file with no hunks rather than one of its hunks. */
export const HEADER_ONLY_OLD_START = 0;

/** A hunk by its git coordinates: its file's path, and the line it starts at on the old side, or 0 for a file with no hunks. */
export const hunkRefSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  oldStart: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(HEADER_ONLY_OLD_START)),
});

export type HunkRef = typeof hunkRefSchema.Type;

/** A line of a file, counted from one. */
const lineNumberSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/**
 * Lines of one file a key change points at: the new file's where it counts
 * additions, the old file's where it counts deletions, from its first line
 * to its last.
 */
export const lineRefSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  side: EffectSchema.Literals(Object.values(LINE_REF_SIDE)),
  startLine: lineNumberSchema,
  endLine: lineNumberSchema,
}).check(EffectSchema.makeFilter((ref) => ref.startLine <= ref.endLine));

export type LineRef = typeof lineRefSchema.Type;

/** One change a reviewer should weigh, in Markdown, and the lines it is on. */
export const keyChangeSchema = EffectSchema.Struct({
  content: EffectSchema.String,
  lineRefs: EffectSchema.Array(lineRefSchema),
});

/**
 * One chapter: what it is, its title, its summary in Markdown, the hunks
 * it holds in the order it reads them, the changes a reviewer should weigh
 * in it, and how risky it is and why, null for "Other changes".
 */
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

/** One hunk a chapter may hold: its name, and the hunk itself, null for a file with no hunks. */
export interface ChapterHunk {
  readonly ref: HunkRef;
  readonly hunk: DiffHunk | null;
}

/** A file's hunks, none where it carries no patch, or one that holds no hunk or does not read as a diff. */
function fileHunks(file: CodingAgentChangedFile): readonly DiffHunk[] {
  if (file.omitted !== null || file.patch === null) return [];
  return patchHunks(file.patch) ?? [];
}

/**
 * Every hunk of the changed files, file by file in the order given, each
 * named by its file and old-side start, and, for a file with none, a pure
 * rename, a binary file, or one whose patch was left out, its name alone
 * (`HEADER_ONLY_OLD_START`).
 */
export function chapterHunks(files: readonly CodingAgentChangedFile[]): readonly ChapterHunk[] {
  return files.flatMap((file): readonly ChapterHunk[] => {
    const hunks = fileHunks(file);
    if (hunks.length === 0) {
      return [{ ref: { path: file.path, oldStart: HEADER_ONLY_OLD_START }, hunk: null }];
    }
    return hunks.map((hunk) => ({ ref: { path: file.path, oldStart: hunk.oldStart }, hunk }));
  });
}

/** Each hunk by its file's path and its old-side start. */
type HunkIndex = ReadonlyMap<string, ReadonlyMap<number, ChapterHunk>>;

/** The hunks indexed by their names, the first of any two that share one kept. */
function indexHunks(hunks: readonly ChapterHunk[]): HunkIndex {
  const index = new Map<string, Map<number, ChapterHunk>>();
  for (const each of hunks) {
    const starts = index.get(each.ref.path) ?? new Map<number, ChapterHunk>();
    index.set(each.ref.path, starts);
    if (!starts.has(each.ref.oldStart)) starts.set(each.ref.oldStart, each);
  }
  return index;
}

/** The hunks a chapter's refs name, each once, in the order it names them; a ref naming no hunk is passed over. */
function chapterOwnHunks(chapter: Chapter, index: HunkIndex): readonly ChapterHunk[] {
  const seen = new Set<ChapterHunk>();
  for (const ref of chapter.hunkRefs) {
    const found = index.get(ref.path)?.get(ref.oldStart);
    if (found !== undefined) seen.add(found);
  }
  return [...seen];
}

/**
 * The ends of the names of files a reader reads past, as ReviewStage's
 * default ignore list writes them (`*.min.js` and the rest): minified and
 * generated files, source maps, snapshots, images, fonts, video, and
 * documents.
 */
const IGNORED_ENDINGS = [
  ".min.js",
  ".min.css",
  ".map",
  ".snap",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".pdf",
] as const;

/** The whole names of files a reader reads past: every lockfile, and what an operating system leaves in a folder. */
const IGNORED_NAMES: ReadonlySet<string> = new Set(
  [...LOCKFILE_NAMES, ".DS_Store", "Thumbs.db"].map((name) => name.toLowerCase()),
);

/**
 * Whether a file is left out of the chapters a model tells and stands in
 * "Other changes" instead, as ReviewStage's default ignore list leaves it
 * out: a lockfile, an operating system's folder metadata, a minified file,
 * a source map, a snapshot, an image, a font, a video, or a document.
 * Matched as `.gitignore` matches a pattern with no slash, whatever its
 * case: against every step of the path, so a folder so named leaves out
 * everything in it.
 */
export function ignoredForChapters(path: string): boolean {
  return path.split("/").some((step) => {
    const name = step.toLowerCase();
    return IGNORED_NAMES.has(name) || IGNORED_ENDINGS.some((ending) => name.endsWith(ending));
  });
}

/** A model's chapters held to the hunks it was given, and the hunks no chapter holds. */
export interface CoveredChapters {
  readonly chapters: readonly Chapter[];
  readonly missing: readonly HunkRef[];
}

/**
 * The chapters with every hunk in exactly one of them, as stage-cli's
 * coverage check holds an agent's: a ref naming no hunk given is dropped, a
 * hunk named twice stays in the first chapter that names it, and a chapter
 * left holding none is dropped. What no chapter holds is named, in the
 * order the hunks were given, so a caller can ask the model to place it
 * and close the story with "Other changes" (`otherChangesChapter`) for what
 * still stands outside.
 */
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

/** The title "Other changes" wears. */
const OTHER_CHANGES_TITLE = "Other changes";

/** What "Other changes" says of itself. */
const OTHER_CHANGES_SUMMARY =
  "Lockfiles, generated files, binary assets, and other files left out of the chapters above, plus pure renames and any change no chapter told.";

/**
 * The fixed chapter that closes a pull request's story, always last: the
 * hunks named, told by no model, so it weighs no change and names no risk.
 */
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

/** Where a hunk stands on one side, from its first line to its last; empty where it counts no line there. */
function sideSpan(hunk: DiffHunk, side: LineRefSide): { first: number; last: number } {
  return side === LINE_REF_SIDE.ADDITIONS
    ? { first: hunk.newStart, last: hunk.newStart + hunk.newLines - 1 }
    : { first: hunk.oldStart, last: hunk.oldStart + hunk.oldLines - 1 };
}

/** Whether two line references point at the same lines. */
function sameLines(a: LineRef, b: LineRef): boolean {
  return (
    a.path === b.path && a.side === b.side && a.startLine === b.startLine && a.endLine === b.endLine
  );
}

/**
 * The chapter with each key change pointing only at lines of its own
 * hunks, as ReviewStage's line-ref check holds one: a reference to a file
 * the chapter holds no hunk of, one starting before line 1 or ending
 * before it starts, one not wholly inside a single hunk of the chapter on
 * its side, and a second reference to the same lines are dropped, and a
 * key change left pointing at nothing is dropped with them.
 */
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

/** A patch's hunks as written, each from its header to the line before the next, in order. */
function hunkTexts(patch: string): readonly string[] {
  const texts: string[][] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) texts.push([line]);
    else texts.at(-1)?.push(line);
  }
  return texts.map((lines) => lines.join("\n"));
}

/** How many lines something adds and removes. */
interface LineCounts {
  readonly additions: number;
  readonly deletions: number;
}

/** The lines a hunk adds and removes. */
function hunkCounts(hunk: DiffHunk): LineCounts {
  return {
    additions: hunk.rows.filter((row) => row.kind === DIFF_ROW.ADDED).length,
    deletions: hunk.rows.filter((row) => row.kind === DIFF_ROW.REMOVED).length,
  };
}

/**
 * The files a chapter draws, each in the order the chapter first names
 * one of its hunks: the file as it changed, its patch holding only the
 * hunks the chapter holds, in the order the patch holds them, each with
 * its own header as written, so the list draws it (`listPatch`) as it
 * draws a whole file's; and the lines those hunks add and remove. A file
 * whose every hunk the chapter holds, and one with no hunks, which the
 * chapter names by `HEADER_ONLY_OLD_START` and the list draws as its
 * header alone, are the very file given. A ref naming no file or hunk
 * draws nothing.
 */
export function chapterPatches(
  chapter: Chapter,
  files: readonly CodingAgentChangedFile[],
): readonly CodingAgentChangedFile[] {
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

/** Whether a line stands among the lines a hunk counts from `start`. */
function within(line: number, start: number, count: number): boolean {
  return line >= start && line < start + count;
}

/**
 * Whether a review thread stands in a chapter, as ReviewStage counts a
 * chapter's comments: a thread on a whole file, which names no line where
 * it stands or where it was made, stands in every chapter holding a hunk
 * of its file; any thread on a file with no hunks, a pure rename or a
 * binary file, stands in the one chapter naming the file, since no hunk
 * places it elsewhere; a thread on lines
 * stands where a hunk of the chapter in its file counts its line, a
 * thread on the old side's line among the hunk's old lines and one on the
 * new side's among its new; and a thread a later push outdated, which
 * names no line where it stands now, by the line it was made on among the
 * hunk's old lines.
 */
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
    // A file with no hunks stands in this chapter alone, so every thread on it does too.
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

/** The lines a chapter's hunks add and remove, each hunk counted once. */
export function chapterLineCounts(chapter: Chapter, hunks: readonly ChapterHunk[]): LineCounts {
  const counts = chapterOwnHunks(chapter, indexHunks(hunks)).flatMap(({ hunk }) =>
    hunk === null ? [] : [hunkCounts(hunk)],
  );
  return {
    additions: counts.reduce((sum, each) => sum + each.additions, 0),
    deletions: counts.reduce((sum, each) => sum + each.deletions, 0),
  };
}

/**
 * A fenced block, an inline code span of one or two backticks, or a literal
 * `\n`. Note that a fenced block is matched before a span, so its fences
 * are not read as spans of their own.
 */
const ESCAPED_NEWLINE = /```[\s\S]*?```|``[\s\S]*?``|`[^`]*`|\\n/gu;

/**
 * A model's words with each literal `\n` it escaped twice read as the
 * newline it meant, in prose and in a fenced block, whose lines a Markdown
 * reader and a diagram need apart; never inside inline code, where the
 * words may mean the escape itself.
 */
export function unescapeLiteralNewlines(text: string): string {
  return text.replace(ESCAPED_NEWLINE, (match) => {
    if (match.startsWith("```")) return match.replaceAll("\\n", "\n");
    if (match.startsWith("`")) return match;
    return "\n";
  });
}
