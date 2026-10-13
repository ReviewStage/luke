import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  type CodingAgentChangedFile,
  PATCH_OMITTED,
} from "@sidecar/hosted/coding-agent-wire";
import { test } from "vitest";
import { CHANGES_WORDS, DIFF_ROW, fileNotice, patchHunks } from "./changes-model";

const MODIFIED: CodingAgentChangedFile = {
  path: "src/invite.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  patch: "@@ -1,1 +1,1 @@\n-a\n+b",
  omitted: null,
};

test("each row of a hunk is numbered on the side it stands on, counting from where its header says", () => {
  const hunks = patchHunks(
    [
      "@@ -10,4 +10,5 @@ export function invite() {",
      " const team = load();",
      "-send(team);",
      "+if (team.open) {",
      "+  send(team);",
      " }",
      "\\ No newline at end of file",
      "@@ -40 +41,2 @@",
      " return;",
      "+done();",
    ].join("\n"),
  );

  assert.deepEqual(
    hunks.map((hunk) => hunk.header),
    ["@@ -10,4 +10,5 @@ export function invite() {", "@@ -40 +41,2 @@"],
  );
  assert.deepEqual(
    hunks.map((hunk) => hunk.rows.map((row) => [row.kind, row.oldLine, row.newLine, row.text])),
    [
      [
        [DIFF_ROW.CONTEXT, 10, 10, "const team = load();"],
        [DIFF_ROW.REMOVED, 11, undefined, "send(team);"],
        [DIFF_ROW.ADDED, undefined, 11, "if (team.open) {"],
        [DIFF_ROW.ADDED, undefined, 12, "  send(team);"],
        [DIFF_ROW.CONTEXT, 12, 13, "}"],
        [DIFF_ROW.NOTE, undefined, undefined, " No newline at end of file"],
      ],
      [
        [DIFF_ROW.CONTEXT, 40, 41, "return;"],
        [DIFF_ROW.ADDED, undefined, 42, "done();"],
      ],
    ],
  );
});

test("a removed line whose own text starts with dashes is still one removed line, not a header", () => {
  const [hunk] = patchHunks("@@ -1,2 +1 @@\n--- a note\n kept");
  assert.deepEqual(
    hunk?.rows.map((row) => [row.kind, row.text]),
    [
      [DIFF_ROW.REMOVED, "-- a note"],
      [DIFF_ROW.CONTEXT, "kept"],
    ],
  );
});

test("a file with no patch says why rather than reading as unchanged, and one with hunks says nothing", () => {
  assert.equal(fileNotice(MODIFIED), undefined);
  assert.equal(
    fileNotice({ ...MODIFIED, patch: null, omitted: PATCH_OMITTED.BINARY }),
    CHANGES_WORDS.OMITTED[PATCH_OMITTED.BINARY],
  );
  assert.equal(
    fileNotice({ ...MODIFIED, patch: null, omitted: PATCH_OMITTED.TOO_LARGE }),
    CHANGES_WORDS.OMITTED[PATCH_OMITTED.TOO_LARGE],
  );
  assert.equal(
    fileNotice({
      ...MODIFIED,
      status: CHANGED_FILE_STATUS.RENAMED,
      previousPath: "src/old.ts",
      patch: "",
    }),
    CHANGES_WORDS.UNCHANGED_CONTENTS,
  );
  assert.equal(fileNotice({ ...MODIFIED, patch: "" }), CHANGES_WORDS.NO_HUNKS);
});
