import assert from "node:assert/strict";
import { DIFF_SIDE } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { DIFF_ROW, threadPreview } from "./changes-model";

/**
 * changes-model.test.ts -- a review thread previews the end of the hunk
 * GitHub froze for it, found on the side its line counts on, from a few
 * rows above its range to its line, though GitHub's header still counts
 * the whole hunk.
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

/** The text and old and new numbers of each row a thread previews. */
function previewOf(thread: Partial<Parameters<typeof threadPreview>[0]>) {
  return threadPreview({
    diffHunk: HUNK,
    originalLine: null,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    ...thread,
  })?.map((row) => [row.kind, row.oldLine, row.newLine, row.text]);
}

test("a thread on a removed line is found on the old side, three rows of context above it, the rows after it left out", () => {
  assert.deepEqual(previewOf({ originalLine: 24, side: DIFF_SIDE.LEFT }), [
    [DIFF_ROW.CONTEXT, 21, 21, "const b = 2;"],
    [DIFF_ROW.CONTEXT, 22, 22, "const c = 3;"],
    [DIFF_ROW.CONTEXT, 23, 23, "const d = 4;"],
    [DIFF_ROW.REMOVED, 24, undefined, "  return late;"],
  ]);
});

test("a range across both sides runs from its first line on the one to its last on the other", () => {
  assert.deepEqual(
    previewOf({
      originalLine: 24,
      originalStartLine: 24,
      side: DIFF_SIDE.RIGHT,
      startSide: DIFF_SIDE.LEFT,
    })?.slice(-2),
    [
      [DIFF_ROW.REMOVED, 24, undefined, "  return late;"],
      [DIFF_ROW.ADDED, undefined, 24, "  return soon;"],
    ],
  );
});

test("a line the hunk does not hold previews the hunk's end, where GitHub ends it, and a hunk with no header previews nothing", () => {
  assert.deepEqual(previewOf({ originalLine: 99 })?.at(-1), [DIFF_ROW.CONTEXT, 25, 25, "}"]);
  assert.equal(previewOf({ diffHunk: "" }), undefined);
  assert.equal(previewOf({ diffHunk: "not a diff" }), undefined);
});
