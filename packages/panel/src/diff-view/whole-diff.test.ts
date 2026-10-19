import assert from "node:assert/strict";
import { parsePatchFiles } from "@pierre/diffs";
import { test } from "vitest";
import { wholeOf } from "./whole-diff.js";

/**
 * whole-diff.test.ts -- a file drawn whole is one hunk holding every line,
 * its changes among them, and a file that only moved, its texts alike, is
 * every one of its lines as context rather than no hunk at all. Synthetic
 * files only.
 */

/** A patch as the list reads it, of one file named as given. */
function read(patch: string) {
  const file = parsePatchFiles(patch)[0]?.files[0];
  return file ?? assert.fail("the patch reads");
}

test("a changed file drawn whole is one hunk of every line, its change among them", () => {
  const drawn = wholeOf(
    read("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2,1 +2,1 @@\n-b\n+B\n"),
    { before: "a\nb\nc\n", after: "a\nB\nc\n" },
  );
  assert.equal(drawn.hunks.length, 1);
  assert.equal(drawn.hunks[0]?.additionStart, 1);
  assert.equal(drawn.hunks[0]?.additionCount, 3);
});

test("a file that only moved, drawn whole, is every one of its lines as context, numbered alike on both sides", () => {
  const moved = read(
    "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n",
  );
  const texts = { before: "a\nb\nc\n", after: "a\nb\nc\n" };
  const drawn = wholeOf(moved, texts);

  assert.equal(drawn.hunks.length, 1);
  const hunk = drawn.hunks[0] ?? assert.fail();
  assert.deepEqual(
    [hunk.additionStart, hunk.additionCount, hunk.deletionStart, hunk.deletionCount],
    [1, 3, 1, 3],
  );
  assert.deepEqual(hunk.hunkContent, [
    { type: "context", lines: 3, additionLineIndex: 0, deletionLineIndex: 0 },
  ]);
  assert.equal(drawn.unifiedLineCount, 3);
  assert.equal(drawn.prevName, "old.ts");
  assert.equal(wholeOf(moved, texts), drawn, "made once for its texts");
});

test("a file of no line that only moved stays without a hunk", () => {
  const moved = read(
    "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n",
  );
  assert.equal(wholeOf(moved, { before: "", after: "" }).hunks.length, 0);
});
