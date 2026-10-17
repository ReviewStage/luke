import assert from "node:assert/strict";
import { CHANGED_FILE_STATUS, DIFF_SIDE, PATCH_OMITTED } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { threadPreview, threadsOn } from "./changes-model";

/**
 * changes-model.test.ts -- a review thread previews the end of the hunk
 * GitHub froze for it, found on the side its line counts on, from a few
 * rows above its range to its line, though GitHub's header still counts
 * the whole hunk: written as a patch of the thread's file whose header
 * counts the rows kept, with the thread's own lines selected.
 */

/** A hunk as GitHub freezes one for a thread: its header counting the whole hunk, its lines cut at the thread's line. */
const HUNK = [
  "@@ -20,9 +20,9 @@ function expire()",
  " const a = 1;",
  " const b = 2;",
  " const c = 3;",
  " const d = 4;",
  "-  return late;",
  "+  return soon;",
  " }",
].join("\n");

/** The head git writes over the thread's file. */
const HEAD = [
  "diff --git a/src/expiry.ts b/src/expiry.ts",
  "--- a/src/expiry.ts",
  "+++ b/src/expiry.ts",
];

/** What a thread on the hunk previews. */
function previewOf(thread: Partial<Parameters<typeof threadPreview>[0]>) {
  return threadPreview({
    path: "src/expiry.ts",
    diffHunk: HUNK,
    originalLine: null,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    ...thread,
  });
}

test("a thread on a removed line is found on the old side, three rows of context above it, the rows after it left out", () => {
  assert.deepEqual(previewOf({ originalLine: 24, side: DIFF_SIDE.LEFT }), {
    patch: [
      ...HEAD,
      "@@ -21,4 +21,3 @@ function expire()",
      " const b = 2;",
      " const c = 3;",
      " const d = 4;",
      "-  return late;",
      "",
    ].join("\n"),
    selected: { start: 24, side: "deletions", end: 24, endSide: "deletions" },
  });
});

test("a range across both sides runs from its first line on the one to its last on the other", () => {
  const preview = previewOf({
    originalLine: 24,
    originalStartLine: 24,
    side: DIFF_SIDE.RIGHT,
    startSide: DIFF_SIDE.LEFT,
  });
  assert.equal(
    preview?.patch.split("\n").slice(3).join("\n"),
    [
      "@@ -21,4 +21,4 @@ function expire()",
      " const b = 2;",
      " const c = 3;",
      " const d = 4;",
      "-  return late;",
      "+  return soon;",
      "",
    ].join("\n"),
  );
  assert.deepEqual(preview?.selected, {
    start: 24,
    side: "deletions",
    end: 24,
    endSide: "additions",
  });
});

test("a thread on a file's first added lines previews them alone, the old side written empty as git writes it", () => {
  const preview = previewOf({
    diffHunk: "@@ -0,0 +1,3 @@\n+one\n+two\n+three",
    originalLine: 2,
    originalStartLine: 1,
  });
  assert.equal(
    preview?.patch.split("\n").slice(3).join("\n"),
    ["@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n"),
  );
  assert.deepEqual(preview?.selected, {
    start: 1,
    side: "additions",
    end: 2,
    endSide: "additions",
  });
});

test("a line the hunk does not hold previews the hunk's end, where GitHub ends it, and a hunk with no header previews nothing", () => {
  assert.equal(previewOf({ originalLine: 99 })?.patch.split("\n").at(-2), " }");
  assert.equal(previewOf({ diffHunk: "" }), undefined);
  assert.equal(previewOf({ diffHunk: "not a diff" }), undefined);
});

/** A thread on `path` at `line` on the new side, keyed by its one comment's page. */
function threadAt(path: string, line: number | null, url: string) {
  return {
    path,
    line,
    startLine: null,
    originalLine: 7,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    diffHunk: HUNK,
    resolved: false,
    outdated: line === null,
    comments: [
      {
        by: { login: "octo", bot: false },
        html: null,
        body: "Why?",
        at: 1,
        url,
      },
    ],
    more: 0,
  };
}

/** The changed file the threads are on: one hunk, old lines 3 to 5 and new lines 3 to 6, line 4 changed and a line added. */
const FILE_A = {
  path: "src/a.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch:
    "@@ -3,3 +3,4 @@\n const c = 3;\n-const d = 4;\n+const d = 5;\n+const e = 6;\n const f = 7;",
};

const R = "https://github.com/acme/relay/pull/7#r";

test("a file's threads stand under the lines its diff draws, on the side they count on, and every other above its diff", () => {
  const { placed, above } = threadsOn(
    [
      { ...threadAt("src/a.ts", 4, `${R}1`), side: DIFF_SIDE.LEFT },
      threadAt("src/a.ts", 5, `${R}2`),
      threadAt("src/a.ts", null, `${R}3`),
      threadAt("src/a.ts", 120, `${R}4`),
      threadAt("src/b.ts", 2, `${R}5`),
      { ...threadAt("src/a.ts", 5, "unused"), comments: [] },
    ],
    FILE_A,
  );

  assert.deepEqual(
    placed.map(({ key, side, line }) => [key, side, line]),
    [
      [`${R}1`, "deletions", 4],
      [`${R}2`, "additions", 5],
    ],
  );
  assert.deepEqual(
    above.map(({ key, line }) => [key, line]),
    [
      [`${R}3`, 7],
      [`${R}4`, 120],
    ],
    "an outdated thread, and one on a line no hunk shows",
  );
});

test("every thread on a file whose diff is not drawn stands above where its diff would", () => {
  const { placed, above } = threadsOn([threadAt("src/a.ts", 4, `${R}1`)], {
    ...FILE_A,
    patch: null,
    omitted: PATCH_OMITTED.BINARY,
  });

  assert.deepEqual(placed, []);
  assert.deepEqual(
    above.map(({ key }) => key),
    [`${R}1`],
  );
});
