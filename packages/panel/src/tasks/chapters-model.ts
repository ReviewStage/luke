import type { CodingAgentChangedFile, ReviewThread } from "@luke/features/coding-agent-wire";
import { patchHunks } from "@luke/features/diff-hunks";
import {
  CHAPTER_KIND,
  type Chapter,
  type ChapterHunk,
  chapterPatches,
  LINE_REF_SIDE,
  type LineRef,
  threadInChapter,
} from "@luke/features/pull-request-chapters";
import type { PullRequestChaptersAnswerView } from "@luke/features/pull-request-chapters-view";
import { PULL_REQUEST_CHAPTERS_STATE } from "@luke/features/pull-request-chapters-wire";
import type { DiffLineSpan } from "../diff-view/contract.js";

/**
 * chapters-model.ts -- a pull request's chapters as its Chapters view draws them: which of its states stands, whether the chapters are stale, the order they are read in, which files each holds, and whether the member has viewed them.
 *
 * The view draws one state at a time (`chaptersShown`): the read on its way,
 * failed, or saying there is no pull request; no chapters yet, offering
 * Generate where the deployment can make them; chapters being made, by this
 * window's own Generate or someone else's; a generation that failed; or the
 * chapters ready, stale where they were made for a head the pull request
 * has moved on from (`chaptersStale`). "Other changes" is always read last
 * (`orderedChapters`). A chapter is viewed once every file it holds is
 * marked viewed on GitHub (`chapterViewed`), and marking it marks each of
 * them, or unmarks them all where all were (`chapterMarks`), so a file two
 * chapters hold is shared by both. A key change's press brings its first
 * lines in the chapter's reading order into view (`firstLineRef`), lit where
 * the chapter's diff draws them (`drawnLines`), else its file's header.
 * Nothing here reads the DOM.
 */

/** Which of its states the Chapters view draws. */
export const CHAPTERS_SHOWN = {
  /** The read is on its way, or asked again after a failure. */
  READING: "reading",
  /** The read did not answer anything the view can draw. */
  FAILED: "failed",
  /** The agent has no pull request, or the number names none. */
  NO_PULL_REQUEST: "no-pull-request",
  /** No chapters were ever asked for this pull request. */
  NONE: "none",
  /** Chapters are being made, by this window's Generate or another's. */
  GENERATING: "generating",
  /** The newest generation was given up on. */
  GENERATION_FAILED: "generation-failed",
  /** The chapters, stale or not. */
  READY: "ready",
} as const;

type Failure = Extract<PullRequestChaptersAnswerView, { failure: unknown }>["failure"];
type Answered = Extract<PullRequestChaptersAnswerView, { pullRequest: unknown }>;
type Answer = NonNullable<Answered["pullRequest"]>;
type FailureKind = Extract<Answer["chapters"], { failureKind: unknown }>["failureKind"];

/** What the view draws, with what each state draws from. */
export type ChaptersShown =
  | { readonly kind: typeof CHAPTERS_SHOWN.READING }
  | { readonly kind: typeof CHAPTERS_SHOWN.FAILED; readonly failure: Failure }
  | { readonly kind: typeof CHAPTERS_SHOWN.NO_PULL_REQUEST }
  | { readonly kind: typeof CHAPTERS_SHOWN.NONE; readonly generatable: boolean }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.GENERATING;
      readonly startedAt: number;
      /** Whether it is this window's own Generate, which answers once they land; else a read shows another's, which only a Refresh sees land. */
      readonly ours: boolean;
    }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.GENERATION_FAILED;
      readonly failureKind: FailureKind;
      readonly generatable: boolean;
    }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.READY;
      readonly chapters: readonly Chapter[];
      readonly stale: boolean;
      readonly generatable: boolean;
    };

/** Whether chapters were made for a head the pull request has since moved on from. */
function chaptersStale(pullRequest: Pick<Answer, "headSha" | "chapters">): boolean {
  const { chapters } = pullRequest;
  return (
    chapters.status !== PULL_REQUEST_CHAPTERS_STATE.NONE && chapters.headSha !== pullRequest.headSha
  );
}

/** The chapters in reading order: the story's own as told, then "Other changes", wherever the answer put it. */
function orderedChapters(chapters: readonly Chapter[]): readonly Chapter[] {
  return [
    ...chapters.filter((chapter) => chapter.kind !== CHAPTER_KIND.OTHER),
    ...chapters.filter((chapter) => chapter.kind === CHAPTER_KIND.OTHER),
  ];
}

/**
 * What the view draws from its read as it stands, and this window's own
 * Generate where one is out, which stands over whatever the read last said
 * until it answers. A failure gives way to the wait as soon as the read is
 * asked again, while anything else drawn stands until the answer lands.
 */
export function chaptersShown(
  answer: PullRequestChaptersAnswerView | undefined,
  out: boolean,
  /** When this window's own Generate was pressed, while it is out. */
  generating: number | undefined,
): ChaptersShown {
  if (generating !== undefined) {
    return { kind: CHAPTERS_SHOWN.GENERATING, startedAt: generating, ours: true };
  }
  if (answer === undefined || (out && "failure" in answer)) return { kind: CHAPTERS_SHOWN.READING };
  if ("failure" in answer) return { kind: CHAPTERS_SHOWN.FAILED, failure: answer.failure };
  const { pullRequest } = answer;
  if (pullRequest === null) return { kind: CHAPTERS_SHOWN.NO_PULL_REQUEST };
  const { chapters, generatable } = pullRequest;
  switch (chapters.status) {
    case PULL_REQUEST_CHAPTERS_STATE.NONE:
      return { kind: CHAPTERS_SHOWN.NONE, generatable };
    case PULL_REQUEST_CHAPTERS_STATE.GENERATING:
      return { kind: CHAPTERS_SHOWN.GENERATING, startedAt: chapters.startedAt, ours: false };
    case PULL_REQUEST_CHAPTERS_STATE.FAILED:
      return {
        kind: CHAPTERS_SHOWN.GENERATION_FAILED,
        failureKind: chapters.failureKind,
        generatable,
      };
    case PULL_REQUEST_CHAPTERS_STATE.READY:
      return {
        kind: CHAPTERS_SHOWN.READY,
        chapters: orderedChapters(chapters.chapters),
        stale: chaptersStale(pullRequest),
        generatable,
      };
  }
}

/** The paths of the files a chapter draws, in the order it first names each. */
export function chapterPaths(
  chapter: Chapter,
  files: readonly CodingAgentChangedFile[],
): readonly string[] {
  return chapterPatches(chapter, files).map((file) => file.path);
}

/** Whether every file of a chapter is marked viewed; never for a chapter that holds none. */
export function chapterViewed(
  paths: readonly string[],
  viewed: (path: string) => boolean,
): boolean {
  return paths.length > 0 && paths.every(viewed);
}

/**
 * The files a press of Mark chapter viewed turns: each one not yet viewed,
 * or, where every one is, all of them, so the press unmarks the chapter.
 */
export function chapterMarks(
  paths: readonly string[],
  viewed: (path: string) => boolean,
): readonly string[] {
  return chapterViewed(paths, viewed) ? paths : paths.filter((path) => !viewed(path));
}

/** How many of the review threads stand in a chapter. */
export function chapterThreadCount(
  chapter: Chapter,
  threads: readonly ReviewThread[],
  hunks: readonly ChapterHunk[],
): number {
  return threads.filter((thread) => threadInChapter(thread, chapter, hunks)).length;
}

/** Lines a key change points at, as its row names them: the file's path, then the line or the lines. */
export function lineRefLabel(ref: LineRef): string {
  const lines =
    ref.startLine === ref.endLine ? `L${ref.startLine}` : `L${ref.startLine}–${ref.endLine}`;
  return `${ref.path} · ${lines}`;
}

/** Where a line ref stands among others of its file at the same line: a removed line before an added one, as a unified diff draws them. */
const SIDE_RANK = { [LINE_REF_SIDE.DELETIONS]: 0, [LINE_REF_SIDE.ADDITIONS]: 1 } as const;

/**
 * The lines of a key change its press brings into view: the first in the
 * chapter's reading order, as ReviewStage orders them, by the file the
 * chapter draws first (`paths`), then by line, a removed line before an
 * added one at the same number, then the shorter run. Lines of files the
 * chapter does not draw come last, in the order the key change names them.
 */
export function firstLineRef(
  refs: readonly LineRef[],
  paths: readonly string[],
): LineRef | undefined {
  const rank = (ref: LineRef) => {
    const at = paths.indexOf(ref.path);
    return at === -1 ? paths.length : at;
  };
  const sorted = [...refs].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.path !== b.path) return 0;
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    if (a.side !== b.side) return SIDE_RANK[a.side] - SIDE_RANK[b.side];
    return a.endLine - b.endLine;
  });
  return sorted[0];
}

/**
 * The lines of `ref` the chapter's diff draws of `file`, the file as the
 * chapter draws it (`chapterPatches`): from its first line to its last, or
 * to the end of the hunk holding its first where it runs past it; none
 * where the file draws no lines, or no hunk it draws holds the first line
 * on its side, which brings the file's header into view instead. Note that
 * a hunk draws every line it counts on a side, its unchanged lines among
 * them, so a run may start on one.
 */
export function drawnLines(
  file: CodingAgentChangedFile | undefined,
  ref: LineRef,
): DiffLineSpan | undefined {
  if (file === undefined || file.path !== ref.path) return undefined;
  if (file.omitted !== null || file.patch === null) return undefined;
  const additions = ref.side === LINE_REF_SIDE.ADDITIONS;
  for (const hunk of patchHunks(file.patch) ?? []) {
    const first = additions ? hunk.newStart : hunk.oldStart;
    const last = first + (additions ? hunk.newLines : hunk.oldLines) - 1;
    if (ref.startLine < first || ref.startLine > last) continue;
    return { side: ref.side, startLine: ref.startLine, endLine: Math.min(ref.endLine, last) };
  }
  return undefined;
}

/** The chapter `step` on from `at` among `count`, held at either end. */
export function steppedChapter(at: number, step: number, count: number): number {
  return Math.min(Math.max(0, count - 1), Math.max(0, at + step));
}
