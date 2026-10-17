import assert from "node:assert/strict";
import { DIFF_SIDE } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { threadPreview } from "./changes-model";

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
