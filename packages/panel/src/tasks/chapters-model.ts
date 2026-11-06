import type { AgentChangedFile, ReviewThread } from "@repo/features/agent-wire";
import {
  CHAPTERS_MODEL_LABEL,
  OPENAI_CHAPTERS_MODEL_LABEL,
} from "@repo/features/chapters-model-choice";
import { patchHunks } from "@repo/features/diff-hunks";
import {
  CHAPTER_KIND,
  type Chapter,
  type ChapterHunk,
  chapterPatches,
  LINE_REF_SIDE,
  type LineRef,
  threadInChapter,
} from "@repo/features/pull-request-chapters";
import type { PullRequestChaptersAnswerView } from "@repo/features/pull-request-chapters-view";
import {
  type ChaptersRunsOn,
  PULL_REQUEST_CHAPTERS_STATE,
} from "@repo/features/pull-request-chapters-wire";
import type { DiffLineSpan } from "../diff-view/contract.js";

export const CHAPTERS_SHOWN = {
  READING: "reading",
  FAILED: "failed",
  NO_PULL_REQUEST: "no-pull-request",
  NONE: "none",
  GENERATING: "generating",
  GENERATION_FAILED: "generation-failed",
  READY: "ready",
} as const;

type Failure = Extract<PullRequestChaptersAnswerView, { failure: unknown }>["failure"];
type Answered = Extract<PullRequestChaptersAnswerView, { pullRequest: unknown }>;
type Answer = NonNullable<Answered["pullRequest"]>;
type FailureKind = Extract<Answer["chapters"], { failureKind: unknown }>["failureKind"];

export type ChaptersShown =
  | { readonly kind: typeof CHAPTERS_SHOWN.READING }
  | { readonly kind: typeof CHAPTERS_SHOWN.FAILED; readonly failure: Failure }
  | { readonly kind: typeof CHAPTERS_SHOWN.NO_PULL_REQUEST }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.NONE;
      readonly generatable: boolean;
      readonly runsOn: ChaptersRunsOn | undefined;
    }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.GENERATING;
      readonly startedAt: number;
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
      readonly model: string;
      readonly stale: boolean;
      readonly generatable: boolean;
    };

const MODEL_LABELS: Readonly<Record<string, string>> = {
  ...CHAPTERS_MODEL_LABEL,
  ...OPENAI_CHAPTERS_MODEL_LABEL,
};

export function chaptersModelLabel(model: string): string {
  return Object.hasOwn(MODEL_LABELS, model) ? (MODEL_LABELS[model] ?? model) : model;
}

export interface ChaptersHeads {
  readonly pullRequest: string | undefined;
  readonly files: string | undefined;
}

function chaptersStale(chapters: Answer["chapters"], heads: ChaptersHeads): boolean {
  if (chapters.status === PULL_REQUEST_CHAPTERS_STATE.NONE) return false;
  const { pullRequest, files } = heads;
  return (
    files !== chapters.headSha || (pullRequest !== undefined && pullRequest !== chapters.headSha)
  );
}

function orderedChapters(chapters: readonly Chapter[]): readonly Chapter[] {
  return [
    ...chapters.filter((chapter) => chapter.kind !== CHAPTER_KIND.OTHER),
    ...chapters.filter((chapter) => chapter.kind === CHAPTER_KIND.OTHER),
  ];
}

export function chaptersShown(
  answer: PullRequestChaptersAnswerView | undefined,
  generating: number | undefined,
  heads: ChaptersHeads = { pullRequest: undefined, files: undefined },
): ChaptersShown {
  if (generating !== undefined) {
    return { kind: CHAPTERS_SHOWN.GENERATING, startedAt: generating, ours: true };
  }
  if (answer === undefined) return { kind: CHAPTERS_SHOWN.READING };
  if ("failure" in answer) return { kind: CHAPTERS_SHOWN.FAILED, failure: answer.failure };
  const { pullRequest } = answer;
  if (pullRequest === null) return { kind: CHAPTERS_SHOWN.NO_PULL_REQUEST };
  const { chapters, generatable } = pullRequest;
  switch (chapters.status) {
    case PULL_REQUEST_CHAPTERS_STATE.NONE:
      return { kind: CHAPTERS_SHOWN.NONE, generatable, runsOn: pullRequest.runsOn };
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
        model: chapters.model,
        stale: chaptersStale(chapters, heads),
        generatable,
      };
  }
}

export function chapterPaths(
  chapter: Chapter,
  files: readonly AgentChangedFile[],
): readonly string[] {
  return chapterPatches(chapter, files).map((file) => file.path);
}

export function chapterViewed(
  paths: readonly string[],
  viewed: (path: string) => boolean,
): boolean {
  return paths.length > 0 && paths.every(viewed);
}

export function chapterMarks(
  paths: readonly string[],
  viewed: (path: string) => boolean,
): readonly string[] {
  return chapterViewed(paths, viewed) ? paths : paths.filter((path) => !viewed(path));
}

export function chapterThreadCount(
  chapter: Chapter,
  threads: readonly ReviewThread[],
  hunks: readonly ChapterHunk[],
): number {
  return threads.filter((thread) => threadInChapter(thread, chapter, hunks)).length;
}

export function lineRefLines(ref: LineRef): string {
  return ref.startLine === ref.endLine ? `L${ref.startLine}` : `L${ref.startLine}–${ref.endLine}`;
}

export function lineRefLabel(ref: LineRef): string {
  return `${ref.path} · ${lineRefLines(ref)}`;
}

const SIDE_RANK = { [LINE_REF_SIDE.DELETIONS]: 0, [LINE_REF_SIDE.ADDITIONS]: 1 } as const;

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

export function drawnLines(
  file: AgentChangedFile | undefined,
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

export function steppedChapter(at: number, step: number, count: number): number {
  return Math.min(Math.max(0, count - 1), Math.max(0, at + step));
}
