import assert from "node:assert/strict";
import { test } from "vitest";
import { fileUrl, lineCountOf } from "./file-tab-model.js";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

const held = (commit: string | undefined) => ({
  repository: "acme/relay",
  branch: "main",
  commit,
  lineCount: 4,
  text: "one\ntwo\nthree\nfour\n",
});

test("a file read at a commit opens GitHub's page at that commit, at its lit lines, and one read with no commit named opens its branch", () => {
  const file = { path: "src/invite.ts", range: { startLine: 2, endLine: 3 }, opened: 1 };

  assert.equal(
    fileUrl(held(HEAD), file),
    `https://github.com/acme/relay/blob/${HEAD}/src/invite.ts#L2-L3`,
  );
  assert.equal(
    fileUrl(held(undefined), file),
    "https://github.com/acme/relay/blob/main/src/invite.ts#L2-L3",
  );
});

test("a file's lines are counted as GitHub counts them: a final newline opens no line, and an empty file holds one", () => {
  assert.equal(lineCountOf("one\ntwo\n"), 2);
  assert.equal(lineCountOf("one\ntwo"), 2);
  assert.equal(lineCountOf(""), 1);
  assert.equal(lineCountOf("\n"), 1);
});
