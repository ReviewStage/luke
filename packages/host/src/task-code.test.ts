import assert from "node:assert/strict";
import type { TaskFileWindow } from "@luke/features/task-wire";
import { it } from "vitest";
import { highlightFile } from "./task-code.js";

const LINE = "const answer = 42;";

/** A one-line window of the file at `path`, as the service sends it. */
function windowAt(path: string): TaskFileWindow {
  return {
    path,
    repository: "acme/api",
    branch: "main",
    firstLine: 1,
    lineCount: 1,
    lines: [LINE],
  };
}

it("a file is coloured by the extension of its own name, whatever its case, and a dot in a directory or opening the name is no extension", () => {
  const coloured = highlightFile(windowAt("packages/web.app/src/Main.TS")).lines[0] ?? [];
  const plain = [[{ text: LINE }]];

  assert.ok(coloured.length > 1, "a TypeScript file is coloured in runs");
  assert.equal(coloured.map((run) => run.text).join(""), LINE);
  assert.deepEqual(highlightFile(windowAt("config.ts/Makefile")).lines, plain);
  assert.deepEqual(highlightFile(windowAt("src/.ts")).lines, plain);
  assert.deepEqual(highlightFile(windowAt("notes.txt")).lines, plain);
});
