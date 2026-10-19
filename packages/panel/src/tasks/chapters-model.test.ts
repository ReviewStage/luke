import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  type CodingAgentChangedFile,
  DIFF_SIDE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import {
  CHAPTER_KIND,
  CHAPTER_RISK,
  type Chapter,
  chapterHunks,
  LINE_REF_SIDE,
} from "@luke/features/pull-request-chapters";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@luke/features/pull-request-chapters-view";
import {
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersState,
} from "@luke/features/pull-request-chapters-wire";
import { test } from "vitest";
import {
  CHAPTERS_SHOWN,
  chapterMarks,
  chapterPaths,
  chaptersShown,
  chapterThreadCount,
  chapterViewed,
  lineRefLabel,
  steppedChapter,
} from "./chapters-model.js";

/**
 * chapters-model.test.ts -- the Chapters view draws one state at a time from
 * its read and its own Generate, chapters made for an older head as stale,
 * "Other changes" last; a chapter is viewed once all its files are, and
 * marking it marks the rest or unmarks them all. Synthetic chapters only.
 */

const HEAD = "b".repeat(40);
const OLDER = "a".repeat(40);
const BASE = "c".repeat(40);

/** A modified file of two hunks, two lines apart. */
const STORE: CodingAgentChangedFile = {
  path: "src/store.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch: ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -10,1 +10,2 @@", " j", "+k"].join("\n"),
};

const LOCK: CodingAgentChangedFile = {
  path: "pnpm-lock.yaml",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 1,
  deletions: 1,
  omitted: null,
  patch: ["@@ -3,1 +3,1 @@", "-x", "+y"].join("\n"),
};

/** A chapter of the story holding the hunks named. */
function chapter(title: string, hunkRefs: Chapter["hunkRefs"]): Chapter {
  return {
    kind: CHAPTER_KIND.STORY,
    title,
    summary: "",
    hunkRefs,
    keyChanges: [],
    risk: CHAPTER_RISK.LOW,
    riskReasons: [],
  };
}

const FIRST = chapter("Read the store", [{ path: STORE.path, oldStart: 1 }]);
const SECOND = chapter("Write the store", [{ path: STORE.path, oldStart: 10 }]);
const OTHER: Chapter = {
  ...chapter("Other changes", [{ path: LOCK.path, oldStart: 3 }]),
  kind: CHAPTER_KIND.OTHER,
  risk: null,
};

/** A read answering the pull request at `HEAD`, its newest chapters as given. */
function answering(
  chapters: PullRequestChaptersState,
  generatable = true,
): PullRequestChaptersAnswerView {
  return { pullRequest: { number: 42, headSha: HEAD, generatable, chapters } };
}

/** Ready chapters made for `headSha`. */
function ready(headSha: string, chapters: readonly Chapter[]): PullRequestChaptersState {
  return {
    status: PULL_REQUEST_CHAPTERS_STATE.READY,
    headSha,
    baseSha: BASE,
    model: "claude",
    chapters,
  };
}

test("the view waits on its first read, and on a read asked again after a failure, but keeps what it drew while asked again", () => {
  const failed = { failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.GITHUB_UNANSWERED } as const;
  const drawn = answering(ready(HEAD, [FIRST]));

  assert.equal(chaptersShown(undefined, true, undefined).kind, CHAPTERS_SHOWN.READING);
  assert.equal(chaptersShown(failed, true, undefined).kind, CHAPTERS_SHOWN.READING);
  assert.deepEqual(chaptersShown(failed, false, undefined), {
    kind: CHAPTERS_SHOWN.FAILED,
    failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.GITHUB_UNANSWERED,
  });
  assert.equal(chaptersShown(drawn, true, undefined).kind, CHAPTERS_SHOWN.READY);
});

test("no pull request, no chapters yet, chapters being made, and a generation that failed are each their own state", () => {
  assert.equal(
    chaptersShown({ pullRequest: null }, false, undefined).kind,
    CHAPTERS_SHOWN.NO_PULL_REQUEST,
  );
  assert.deepEqual(
    chaptersShown(answering({ status: PULL_REQUEST_CHAPTERS_STATE.NONE }, false), false, undefined),
    { kind: CHAPTERS_SHOWN.NONE, generatable: false },
  );
  assert.deepEqual(
    chaptersShown(
      answering({
        status: PULL_REQUEST_CHAPTERS_STATE.GENERATING,
        headSha: HEAD,
        baseSha: BASE,
        startedAt: 5_000,
      }),
      false,
      undefined,
    ),
    { kind: CHAPTERS_SHOWN.GENERATING, startedAt: 5_000, ours: false },
  );
  assert.deepEqual(
    chaptersShown(
      answering({
        status: PULL_REQUEST_CHAPTERS_STATE.FAILED,
        headSha: HEAD,
        baseSha: BASE,
        failureKind: PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE,
      }),
      false,
      undefined,
    ),
    {
      kind: CHAPTERS_SHOWN.GENERATION_FAILED,
      failureKind: PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE,
      generatable: true,
    },
  );
});

test("this window's own Generate stands over whatever the read last said, timed from its press", () => {
  const shown = chaptersShown(answering(ready(OLDER, [FIRST])), false, 9_000);

  assert.deepEqual(shown, { kind: CHAPTERS_SHOWN.GENERATING, startedAt: 9_000, ours: true });
});

test("chapters made for an older head are stale, those for the head now are not, and Other changes is read last wherever it was put", () => {
  const current = chaptersShown(answering(ready(HEAD, [OTHER, FIRST, SECOND])), false, undefined);
  const older = chaptersShown(answering(ready(OLDER, [FIRST])), false, undefined);

  assert.equal(current.kind, CHAPTERS_SHOWN.READY);
  assert.equal(older.kind, CHAPTERS_SHOWN.READY);
  if (current.kind !== CHAPTERS_SHOWN.READY || older.kind !== CHAPTERS_SHOWN.READY) return;
  assert.equal(current.stale, false);
  assert.equal(older.stale, true);
  assert.deepEqual(
    current.chapters.map((each) => each.title),
    ["Read the store", "Write the store", "Other changes"],
  );
});

test("a chapter is viewed once every file it holds is, so a file two chapters share is viewed in both; one holding no file is never viewed", () => {
  const files = [STORE, LOCK];
  const viewed = new Set([STORE.path]);
  const isViewed = (path: string) => viewed.has(path);

  assert.equal(chapterViewed(chapterPaths(FIRST, files), isViewed), true);
  assert.equal(chapterViewed(chapterPaths(SECOND, files), isViewed), true, "the file is shared");
  assert.equal(chapterViewed(chapterPaths(OTHER, files), isViewed), false);
  assert.equal(chapterViewed(chapterPaths(chapter("Gone", []), files), isViewed), false);
});

test("marking a chapter turns the files not yet viewed, and marking a viewed one turns them all back", () => {
  const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const some = new Set(["src/b.ts"]);

  assert.deepEqual(
    chapterMarks(paths, (path) => some.has(path)),
    ["src/a.ts", "src/c.ts"],
  );
  assert.deepEqual(
    chapterMarks(paths, () => true),
    paths,
  );
});

test("a chapter counts the review threads on its own hunks, and one on the whole file in every chapter holding a hunk of it", () => {
  const hunks = chapterHunks([STORE, LOCK]);
  const on = (line: number | null): ReviewThread => ({
    path: STORE.path,
    line,
    startLine: null,
    originalLine: line,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    diffHunk: "",
    resolved: false,
    outdated: false,
    comments: [],
    more: 0,
  });
  const threads = [on(2), on(11), on(null)];

  assert.equal(chapterThreadCount(FIRST, threads, hunks), 2);
  assert.equal(chapterThreadCount(SECOND, threads, hunks), 2);
  assert.equal(chapterThreadCount(OTHER, threads, hunks), 0);
});

test("a key change's lines are named by path then line, a range by its ends", () => {
  const ref = { path: "src/store.ts", side: LINE_REF_SIDE.ADDITIONS, startLine: 12, endLine: 20 };

  assert.equal(lineRefLabel(ref), "src/store.ts · L12–20");
  assert.equal(lineRefLabel({ ...ref, endLine: 12 }), "src/store.ts · L12");
});

test("stepping through chapters holds at either end", () => {
  assert.equal(steppedChapter(0, -1, 3), 0);
  assert.equal(steppedChapter(1, 1, 3), 2);
  assert.equal(steppedChapter(2, 1, 3), 2);
});
