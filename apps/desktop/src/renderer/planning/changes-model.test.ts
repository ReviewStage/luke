import assert from "node:assert/strict";
import { test } from "vitest";
import { markChangedWords, patchHunks, splitRows } from "./changes-model";

/**
 * A Changes tab's hunk drawn side by side, and the words a changed line
 * changed: each removed line beside the added line at its place in the run
 * after it, a line of context on both sides, and the words only one side
 * of such a pair holds marked on that side.
 */

/** The rows of a patch's one hunk. */
function rowsOf(patch: string) {
  const hunk = patchHunks(patch)?.[0];
  assert.ok(hunk !== undefined);
  return hunk.rows;
}

/** A split row as the old side's text and the new side's, with nothing for a side left empty. */
function sides(row: ReturnType<typeof splitRows>[number]) {
  return [row.old?.text ?? null, row.new?.text ?? null];
}

test("a split hunk lays each removed line beside the added line at its place, the longer run's rest beside nothing, and context on both sides", () => {
  const rows = rowsOf(
    [
      "@@ -1,5 +1,5 @@",
      " import { invite } from './invite';",
      "-const team = 'old';",
      "-const seats = 3;",
      "-const plan = 'free';",
      "+const team = 'new';",
      "+const seats = 4;",
      " export { team };",
      "+export { seats };",
    ].join("\n"),
  );

  assert.deepEqual(splitRows(rows).map(sides), [
    ["import { invite } from './invite';", "import { invite } from './invite';"],
    ["const team = 'old';", "const team = 'new';"],
    ["const seats = 3;", "const seats = 4;"],
    ["const plan = 'free';", null],
    ["export { team };", "export { team };"],
    [null, "export { seats };"],
  ]);
});

test("a split hunk keeps old and new line numbers on their own sides, and a removed line after added ones starts a run of its own", () => {
  const rows = rowsOf(["@@ -10,1 +10,2 @@", "+first", "-second", "+third"].join("\n"));

  assert.deepEqual(
    splitRows(rows).map((row) => [row.old?.oldLine ?? null, row.new?.newLine ?? null]),
    [
      [null, 10],
      [10, 11],
    ],
  );
});

test("git's note stays on the side of the line it follows, and on both sides after a line of context", () => {
  const rows = rowsOf(
    [
      "@@ -1,2 +1,2 @@",
      " kept",
      "\\ No newline at end of file",
      "-last",
      "\\ No newline at end of file",
      "+last line",
    ].join("\n"),
  );

  assert.deepEqual(splitRows(rows).map(sides), [
    ["kept", "kept"],
    [" No newline at end of file", " No newline at end of file"],
    ["last", "last line"],
    [" No newline at end of file", null],
  ]);
});

test("git's note pairs with no line, so a longer run's rest still stands beside nothing after it", () => {
  const rows = rowsOf(
    ["@@ -1,2 +1 @@", "-first", "-second", "+only", "\\ No newline at end of file"].join("\n"),
  );

  assert.deepEqual(splitRows(rows).map(sides), [
    ["first", "only"],
    [null, " No newline at end of file"],
    ["second", null],
  ]);
});

test("a removed line and the added line beside it mark the words only their own side holds, and every other row is left whole", () => {
  const rows = rowsOf(
    [
      "@@ -1,2 +1,3 @@",
      " const kept = true;",
      "-const seats = 3;",
      "+const seats = 42;",
      "+const extra = 1;",
    ].join("\n"),
  );

  const marked = markChangedWords(rows);

  assert.deepEqual(
    marked.map((row) => row.words ?? null),
    [
      null,
      [
        { text: "const seats = ", changed: false },
        { text: "3", changed: true },
        { text: ";", changed: false },
      ],
      [
        { text: "const seats = ", changed: false },
        { text: "42", changed: true },
        { text: ";", changed: false },
      ],
      null,
    ],
  );
});

test("a line rewritten with no word in common is tinted whole rather than cut into words", () => {
  const rows = rowsOf(["@@ -1 +1 @@", "-alpha beta", "+gamma"].join("\n"));

  assert.deepEqual(
    markChangedWords(rows).map((row) => row.words ?? null),
    [null, null],
  );
});
