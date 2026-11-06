// @vitest-environment jsdom

import assert from "node:assert/strict";
import { FileDiff, getSharedHighlighter, parseDiffFromFile, parsePatchFiles } from "@pierre/diffs";
import { beforeAll, test } from "vitest";
import { drawnAmong, drawnTeller } from "./drawn-lines.js";

function changedFile() {
  const lines = Array.from({ length: 100 }, (_line, at) => `const line${at + 1} = ${at + 1};`);
  const after = lines.map((line, at) => (at === 4 || at === 89 ? `${line} // changed` : line));
  return parseDiffFromFile(
    { name: "a.ts", contents: `${lines.join("\n")}\n` },
    { name: "a.ts", contents: `${after.join("\n")}\n` },
  );
}

const HIDDEN = [12, 50, 80];

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

test("the view is told a file's drawn lines only as they change, and that a file the list lets go, or a list taken down, draws none", () => {
  const heard: Array<[string, readonly number[]]> = [];
  const teller = drawnTeller((path, lines) => heard.push([path, lines]));

  teller.tell("a.ts", []);
  teller.tell("a.ts", [30]);
  teller.tell("a.ts", [30]);
  teller.tell("b.ts", [12]);
  assert.deepEqual(heard, [
    ["a.ts", [30]],
    ["b.ts", [12]],
  ]);

  teller.forget(new Set(["a.ts"]));
  assert.deepEqual(heard.at(-1), ["b.ts", []]);
  assert.deepEqual(teller.told("b.ts"), []);

  teller.forget(new Set());
  assert.deepEqual(heard.at(-1), ["a.ts", []]);
  assert.equal(heard.length, 4, "nothing is told twice");
});
