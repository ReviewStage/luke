// @vitest-environment jsdom

/**
 * drawn-lines.test.ts -- a line between a file's hunks is drawn once a gap
 * is opened over it, up, down, or all at once, as Pierre itself draws the
 * file; and a file Pierre has not read whole draws none of them, though
 * Pierre says every line of such a file stands. Synthetic files only.
 */

import assert from "node:assert/strict";
import { FileDiff, getSharedHighlighter, parseDiffFromFile, parsePatchFiles } from "@pierre/diffs";
import { beforeAll, test } from "vitest";
import { drawnAmong } from "./drawn-lines.js";

/** A file of a hundred lines, the fifth and the ninetieth changed, so one long gap stands between its two hunks. */
function changedFile() {
  const lines = Array.from({ length: 100 }, (_line, at) => `const line${at + 1} = ${at + 1};`);
  const after = lines.map((line, at) => (at === 4 || at === 89 ? `${line} // changed` : line));
  return parseDiffFromFile(
    { name: "a.ts", contents: `${lines.join("\n")}\n` },
    { name: "a.ts", contents: `${after.join("\n")}\n` },
  );
}

/** The lines between the hunks a thread could wait on: near the gap's top, its middle, and near its foot. */
const HIDDEN = [12, 50, 80];

/** The file drawn by Pierre as Files changed draws it, twenty lines a press. */
function drawn(fileDiff = changedFile()) {
  const view = new FileDiff<string, undefined>({
    theme: { dark: "github-dark", light: "github-light" },
    preferredHighlighter: "shiki-js",
    expansionLineCount: 20,
  });
  const container = document.body.appendChild(document.createElement("div"));
  view.render({ fileDiff, fileContainer: container });
  return view;
}

beforeAll(async () => {
  // Note that the highlighter is loaded first, so Pierre draws the file at once.
  await getSharedHighlighter({
    themes: ["github-dark", "github-light"],
    langs: ["typescript"],
    preferredHighlighter: "shiki-js",
  });
});

test("a line between hunks is drawn once a gap opens over it, up, then down, then all at once", () => {
  const view = drawn();
  assert.deepEqual(drawnAmong(view, HIDDEN), [], "every gap stands closed");

  view.expandHunk(1, "up");
  assert.deepEqual(drawnAmong(view, HIDDEN), [12]);

  view.expandHunk(1, "down");
  assert.deepEqual(drawnAmong(view, HIDDEN), [12, 80]);

  view.expandHunk(1, "both", Number.POSITIVE_INFINITY);
  assert.deepEqual(drawnAmong(view, HIDDEN), HIDDEN);
});

test("a file read from its patch alone draws none of the lines between its hunks", () => {
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -4,3 +4,3 @@",
    " const line4 = 4;",
    "-const line5 = 5;",
    "+const line5 = 5; // changed",
    " const line6 = 6;",
    "",
  ].join("\n");
  const read = parsePatchFiles(patch)[0]?.files[0] ?? assert.fail("the patch reads");
  const view = drawn(read);

  assert.equal(view.isLineRenderable(50), true, "Pierre says a line of a partial file stands");
  assert.deepEqual(drawnAmong(view, HIDDEN), []);
});
