import assert from "node:assert/strict";
import { Schema as EffectSchema } from "effect";
import { test } from "vitest";
import {
  CHANGED_FILE_STATUS,
  type CodingAgentChangedFile,
  DIFF_SIDE,
  PATCH_OMITTED,
  type ReviewThread,
} from "./coding-agent-wire.js";
import {
  CHAPTER_KIND,
  CHAPTER_RISK,
  type Chapter,
  chapterHunks,
  chapterLineCounts,
  chapterPatches,
  chapterSchema,
  coverHunks,
  HEADER_ONLY_OLD_START,
  type HunkRef,
  hunkRefSchema,
  ignoredForChapters,
  keyChangeSchema,
  LINE_REF_SIDE,
  type LineRef,
  lineRefSchema,
  otherChangesChapter,
  threadInChapter,
  unescapeLiteralNewlines,
  validLineRefs,
} from "./pull-request-chapters.js";

/**
 * pull-request-chapters.test.ts -- a model's chapters held to the diff they tell: every hunk in exactly one chapter, key changes on their own chapter's lines, each chapter drawing its own hunks with the threads on them, and the files a reader reads past left to "Other changes".
 */

/** The first hunk of `src/seats.ts`: old lines 1–3, new lines 1–4. */
const SEATS_FIRST = ["@@ -1,3 +1,4 @@ function seats()", " one", "+two", " three", " four"];

/** The second hunk of `src/seats.ts`: old lines 10–11, new lines 11–12. */
const SEATS_SECOND = ["@@ -10,2 +11,2 @@", " ten", "-eleven", "+ELEVEN"];

/** A changed file, modified with the patch given unless told otherwise. */
function changed(
  path: string,
  patch: string | null,
  rest: Partial<CodingAgentChangedFile> = {},
): CodingAgentChangedFile {
  return {
    path,
    previousPath: null,
    status: CHANGED_FILE_STATUS.MODIFIED,
    additions: 0,
    deletions: 0,
    patch,
    omitted: null,
    ...rest,
  };
}

const SEATS = changed("src/seats.ts", `${[...SEATS_FIRST, ...SEATS_SECOND].join("\n")}\n`, {
  additions: 2,
  deletions: 1,
});
const ADDED = changed(
  "src/invite.ts",
  "@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;",
  {
    status: CHANGED_FILE_STATUS.ADDED,
    additions: 2,
  },
);
const LOGO = changed("assets/logo.png", null, { omitted: PATCH_OMITTED.BINARY });
const MOVED = changed("src/moved.ts", "", {
  status: CHANGED_FILE_STATUS.RENAMED,
  previousPath: "src/old.ts",
});
const FILES = [SEATS, ADDED, LOGO, MOVED];
const HUNKS = chapterHunks(FILES);

/** A story chapter holding the hunks named. */
function story(title: string, hunkRefs: readonly HunkRef[], rest: Partial<Chapter> = {}): Chapter {
  return {
    kind: CHAPTER_KIND.STORY,
    title,
    summary: `${title}.`,
    hunkRefs,
    keyChanges: [],
    risk: CHAPTER_RISK.LOW,
    riskReasons: [],
    ...rest,
  };
}

const seatsFirst = { path: "src/seats.ts", oldStart: 1 };
const seatsSecond = { path: "src/seats.ts", oldStart: 10 };
// A hunk adding a file starts at 0 on the old side, as a file with no hunks is named.
const added = { path: "src/invite.ts", oldStart: 0 };
const logo = { path: "assets/logo.png", oldStart: HEADER_ONLY_OLD_START };
const moved = { path: "src/moved.ts", oldStart: HEADER_ONLY_OLD_START };

test("every hunk is named by its file and old-side start, and a file with none, binary, a pure rename, or its patch left out, by its path alone", () => {
  const tooLarge = changed("src/huge.ts", null, { omitted: PATCH_OMITTED.TOO_LARGE });
  const hunks = chapterHunks([...FILES, tooLarge]);
  assert.deepEqual(
    hunks.map((each) => [each.ref, each.hunk?.header ?? null, each.hunk?.rows.length ?? 0]),
    [
      [seatsFirst, "@@ -1,3 +1,4 @@ function seats()", 4],
      [seatsSecond, "@@ -10,2 +11,2 @@", 3],
      [added, "@@ -0,0 +1,2 @@", 2],
      [logo, null, 0],
      [moved, null, 0],
      [{ path: "src/huge.ts", oldStart: 0 }, null, 0],
    ],
  );
});

test("lockfiles, folder metadata, minified files, maps, snapshots, images, fonts, video, and documents are left out of the chapters, whatever their case or folder", () => {
  for (const path of [
    "pnpm-lock.yaml",
    "apps/web/package-lock.json",
    "deno.lock",
    "ios/Podfile.lock",
    "docs/.DS_Store",
    "vendor/jquery.min.js",
    "dist/site.MIN.CSS",
    "dist/app.js.map",
    "src/__snapshots__/card.test.ts.snap",
    "assets/Logo.PNG",
    "fonts/inter.woff2",
    "media/demo.mp4",
    "docs/guide.pdf",
    "public/icon.svg",
    "assets/raw.png/notes.txt",
  ]) {
    assert.equal(ignoredForChapters(path), true, path);
  }
  for (const path of [
    "src/seats.ts",
    "src/sitemap.ts",
    "src/map.ts",
    "src/lockfile.ts",
    "docs/pdf-export.md",
  ]) {
    assert.equal(ignoredForChapters(path), false, path);
  }
});

test("every hunk lands in exactly one chapter: an unknown ref is dropped, a hunk named twice stays in its first chapter, an emptied chapter goes, and what none holds is named in diff order", () => {
  const { chapters, missing } = coverHunks(
    [
      story("Seat counts", [seatsSecond, { path: "src/gone.ts", oldStart: 4 }, seatsSecond]),
      story("Invites", [added, seatsSecond, { path: "src/seats.ts", oldStart: 7 }]),
      story("Nothing real", [{ path: "src/gone.ts", oldStart: 1 }]),
      story("Logo", [logo]),
    ],
    HUNKS,
  );
  assert.deepEqual(
    chapters.map((chapter) => [chapter.title, chapter.hunkRefs]),
    [
      ["Seat counts", [seatsSecond]],
      ["Invites", [added]],
      ["Logo", [logo]],
    ],
  );
  assert.deepEqual(missing, [seatsFirst, moved]);
});

test("what no chapter holds closes the story as Other changes, which weighs no change and names no risk", () => {
  const { chapters, missing } = coverHunks([story("Seat counts", [seatsFirst])], HUNKS);
  const told = [...chapters, otherChangesChapter(missing)];
  const last = told.at(-1);
  assert.deepEqual(
    { kind: last?.kind, title: last?.title, risk: last?.risk, keyChanges: last?.keyChanges },
    { kind: CHAPTER_KIND.OTHER, title: "Other changes", risk: null, keyChanges: [] },
  );
  assert.deepEqual(last?.hunkRefs, [seatsSecond, added, logo, moved]);
});

/** A line reference to the lines given. */
function lines(path: string, side: LineRef["side"], startLine: number, endLine: number): LineRef {
  return { path, side, startLine, endLine };
}

test("a key change keeps only references wholly inside one of its chapter's own hunks on their side, each once, and goes when none is left", () => {
  const inFirst = lines("src/seats.ts", LINE_REF_SIDE.ADDITIONS, 2, 4);
  const removed = lines("src/seats.ts", LINE_REF_SIDE.DELETIONS, 11, 11);
  const chapter = story("Seat counts", [seatsFirst, seatsSecond], {
    keyChanges: [
      {
        content: "Is the new line counted?",
        lineRefs: [
          inFirst,
          inFirst,
          removed,
          // Spans two hunks' new sides, wholly inside neither.
          lines("src/seats.ts", LINE_REF_SIDE.ADDITIONS, 4, 11),
          // Past the first hunk's new side.
          lines("src/seats.ts", LINE_REF_SIDE.ADDITIONS, 3, 5),
          lines("src/seats.ts", LINE_REF_SIDE.DELETIONS, 0, 2),
          lines("src/seats.ts", LINE_REF_SIDE.ADDITIONS, 3, 2),
        ],
      },
      {
        content: "Does the invite export both?",
        // A file another chapter holds.
        lineRefs: [lines("src/invite.ts", LINE_REF_SIDE.ADDITIONS, 1, 2)],
      },
    ],
  });
  assert.deepEqual(validLineRefs(chapter, HUNKS).keyChanges, [
    { content: "Is the new line counted?", lineRefs: [inFirst, removed] },
  ]);
});

test("no line is on the side a hunk adding a file counts nothing of", () => {
  const chapter = story("Invites", [added], {
    keyChanges: [
      {
        content: "Both exports?",
        lineRefs: [
          lines("src/invite.ts", LINE_REF_SIDE.DELETIONS, 1, 1),
          lines("src/invite.ts", LINE_REF_SIDE.ADDITIONS, 1, 2),
        ],
      },
    ],
  });
  assert.deepEqual(validLineRefs(chapter, HUNKS).keyChanges[0]?.lineRefs, [
    lines("src/invite.ts", LINE_REF_SIDE.ADDITIONS, 1, 2),
  ]);
});

test("a stored chapter refuses a hunk before line 0, a line reference before line 1 or ending before it starts, and a kind or risk it does not know", () => {
  const hunkRef = EffectSchema.decodeUnknownExit(hunkRefSchema);
  const lineRef = EffectSchema.decodeUnknownExit(lineRefSchema);
  const keyChange = EffectSchema.decodeUnknownExit(keyChangeSchema);
  assert.equal(hunkRef({ path: "src/a.ts", oldStart: -1 })._tag, "Failure");
  assert.equal(lineRef(lines("src/a.ts", LINE_REF_SIDE.ADDITIONS, 3, 2))._tag, "Failure");
  assert.equal(lineRef(lines("src/a.ts", LINE_REF_SIDE.ADDITIONS, 0, 2))._tag, "Failure");
  assert.equal(
    keyChange({ content: "Why?", lineRefs: [lines("src/a.ts", LINE_REF_SIDE.DELETIONS, 2, 1)] })
      ._tag,
    "Failure",
  );
  const chapter = story("Seat counts", [seatsFirst]);
  const stored = EffectSchema.decodeUnknownExit(chapterSchema);
  assert.equal(stored(chapter)._tag, "Success");
  assert.equal(stored({ ...chapter, kind: "prologue" })._tag, "Failure");
  assert.equal(stored({ ...chapter, risk: "severe" })._tag, "Failure");
});

test("a chapter draws its files in the order it first names them, each patch holding only its own hunks under their own headers, with the lines they change", () => {
  const drawn = chapterPatches(
    story("Seat counts", [added, seatsSecond, { path: "src/gone.ts", oldStart: 0 }]),
    FILES,
  );
  assert.deepEqual(
    drawn.map((file) => file.path),
    ["src/invite.ts", "src/seats.ts"],
  );
  assert.equal(drawn[0], ADDED);
  assert.deepEqual(drawn[1], {
    ...SEATS,
    patch: `${SEATS_SECOND.join("\n")}\n`,
    additions: 1,
    deletions: 1,
  });
});

test("a chapter holding one hunk of a file draws that hunk alone, and one naming a file without hunks draws the file as it is, its header alone", () => {
  const [seats] = chapterPatches(story("First", [seatsFirst]), FILES);
  assert.equal(seats?.patch, SEATS_FIRST.join("\n"));
  assert.deepEqual([seats?.additions, seats?.deletions], [1, 0]);
  assert.deepEqual(chapterPatches(story("Assets", [logo, moved]), FILES), [LOGO, MOVED]);
  assert.deepEqual(chapterPatches(story("Wrong start", [{ ...logo, oldStart: 3 }]), FILES), []);
});

/** A review thread on `src/seats.ts`, on the new side's line given unless told otherwise. */
function thread(rest: Partial<ReviewThread>): ReviewThread {
  return {
    path: "src/seats.ts",
    line: null,
    startLine: null,
    originalLine: null,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    diffHunk: "",
    resolved: false,
    outdated: false,
    comments: [],
    more: 0,
    ...rest,
  };
}

test("a thread stands in a chapter where one of its hunks counts the thread's line on its side, an outdated one by the line it was made on among the old lines", () => {
  const first = story("First", [seatsFirst]);
  const second = story("Second", [seatsSecond]);
  const where = (each: ReviewThread) =>
    [first, second].filter((chapter) => threadInChapter(each, chapter, HUNKS)).map((c) => c.title);
  // New line 4 is the first hunk's last; new line 11 the second's first.
  assert.deepEqual(where(thread({ line: 4 })), ["First"]);
  assert.deepEqual(where(thread({ line: 11 })), ["Second"]);
  assert.deepEqual(where(thread({ line: 11, side: DIFF_SIDE.LEFT })), ["Second"]);
  assert.deepEqual(where(thread({ line: 4, side: DIFF_SIDE.LEFT })), []);
  assert.deepEqual(where(thread({ line: null, originalLine: 2, outdated: true })), ["First"]);
  assert.deepEqual(where(thread({ line: 4, path: "src/invite.ts" })), []);
});

test("a thread on a whole file stands in every chapter holding a hunk of it, or naming it where it has none", () => {
  const whole = thread({});
  assert.equal(threadInChapter(whole, story("Second", [seatsSecond]), HUNKS), true);
  assert.equal(threadInChapter(whole, story("Invites", [added]), HUNKS), false);
  assert.equal(
    threadInChapter({ ...whole, path: "assets/logo.png" }, story("Assets", [logo]), HUNKS),
    true,
  );
});

test("a chapter's lines are what its own hunks add and remove, each counted once", () => {
  assert.deepEqual(
    chapterLineCounts(story("Most", [seatsFirst, seatsSecond, added, seatsFirst, logo]), HUNKS),
    { additions: 4, deletions: 1 },
  );
});

test("a literal \\n a model escaped twice is a newline in prose and in a fenced block, never in inline code", () => {
  assert.equal(
    unescapeLiteralNewlines("First paragraph.\\n\\nUses the `\\n` and ``\\n`` escapes."),
    "First paragraph.\n\nUses the `\\n` and ``\\n`` escapes.",
  );
  assert.equal(
    unescapeLiteralNewlines("Flow.\\n\\n```mermaid\\nsequenceDiagram\\n    A->>B: hi\\n```"),
    "Flow.\n\n```mermaid\nsequenceDiagram\n    A->>B: hi\n```",
  );
  assert.equal(unescapeLiteralNewlines("plain words"), "plain words");
});
