import assert from "node:assert/strict";
import { test } from "vitest";
import { fileUrl } from "./file-tab-model.js";

/**
 * A File tab's page on GitHub: the commit its lines were read at, where the
 * service named one, so the page holds the lines the tab draws, and the
 * branch where it named none.
 */

const HEAD = "0123456789abcdef0123456789abcdef01234567";

const held = (commit: string | undefined) => ({
  repository: "acme/relay",
  branch: "main",
  commit,
  lineCount: 4,
  firstLine: 1,
  lines: [],
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
