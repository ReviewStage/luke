import assert from "node:assert/strict";
import { test } from "vitest";
import { DIFF_ROW, patchHunks } from "./diff-hunks.js";

/**
 * diff-hunks.test.ts -- a patch read as hunks: each keeps its header as written and the starts and counts git wrote in it, and each row is numbered on the side it stands on.
 */

test("each hunk keeps its header and git's starts and counts, its rows numbered on the sides they stand on", () => {
  const hunks = patchHunks(
    [
      "@@ -4,3 +4,3 @@ function expire()",
      " const a = 1;",
      "---flag;",
      "+--flag;",
      " }",
      "@@ -20 +20,2 @@",
      " last",
      "+after",
      "\\ No newline at end of file",
    ].join("\n"),
  );
  assert.deepEqual(hunks, [
    {
      header: "@@ -4,3 +4,3 @@ function expire()",
      oldStart: 4,
      oldLines: 3,
      newStart: 4,
      newLines: 3,
      rows: [
        { kind: DIFF_ROW.CONTEXT, oldLine: 4, newLine: 4, text: "const a = 1;" },
        { kind: DIFF_ROW.REMOVED, oldLine: 5, newLine: undefined, text: "--flag;" },
        { kind: DIFF_ROW.ADDED, oldLine: undefined, newLine: 5, text: "--flag;" },
        { kind: DIFF_ROW.CONTEXT, oldLine: 6, newLine: 6, text: "}" },
      ],
    },
    {
      header: "@@ -20 +20,2 @@",
      oldStart: 20,
      oldLines: 1,
      newStart: 20,
      newLines: 2,
      rows: [
        { kind: DIFF_ROW.CONTEXT, oldLine: 20, newLine: 20, text: "last" },
        { kind: DIFF_ROW.ADDED, oldLine: undefined, newLine: 21, text: "after" },
        {
          kind: DIFF_ROW.NOTE,
          oldLine: undefined,
          newLine: undefined,
          text: " No newline at end of file",
        },
      ],
    },
  ]);
});

test("a hunk adding a file starts at 0 on the old side, as git writes it", () => {
  const [hunk] = patchHunks("@@ -0,0 +1,2 @@\n+one\n+two\n") ?? [];
  assert.deepEqual(
    { oldStart: hunk?.oldStart, oldLines: hunk?.oldLines, newStart: hunk?.newStart },
    { oldStart: 0, oldLines: 0, newStart: 1 },
  );
  assert.deepEqual(
    hunk?.rows.map((row) => row.newLine),
    [1, 2],
  );
});

test("a patch whose lines fall short of its header reads as no hunks at all, and words that are no patch as none", () => {
  assert.equal(patchHunks("@@ -1,2 +1,2 @@\n+a"), undefined);
  assert.deepEqual(patchHunks("not a patch"), []);
});
