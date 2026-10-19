import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  type CodingAgentChangedFile,
  DIFF_SIDE,
  PATCH_OMITTED,
} from "@luke/features/coding-agent-wire";
import { createPatch } from "diff";
import { test } from "vitest";
import { DIFF_SELECTION_SIDE } from "../diff-view/contract.js";
import {
  blobShaOf,
  commentLines,
  commentLinesLabel,
  filterFiles,
  rowPlace,
  startsCollapsed,
  suggestedLines,
  textsOf,
  threadPreview,
  threadsOn,
  treeOrder,
} from "./changes-model.js";

/**
 * changes-model.test.ts -- a review thread previews the end of the hunk
 * GitHub froze for it, found on the side its line counts on, from a few
 * rows above its range to its line, though GitHub's header still counts
 * the whole hunk: written as a patch of the thread's file whose header
 * counts the rows kept, with the thread's own lines selected. Files
 * changed lists its files in the tree's order, keeps those whose path holds
 * a filter, and folds what is rarely read.
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

/** The head git writes over the thread's file. */
const HEAD = [
  "diff --git a/src/expiry.ts b/src/expiry.ts",
  "--- a/src/expiry.ts",
  "+++ b/src/expiry.ts",
];

/** What a thread on the hunk previews. */
function previewOf(thread: Partial<Parameters<typeof threadPreview>[0]>) {
  return threadPreview({
    path: "src/expiry.ts",
    diffHunk: HUNK,
    originalLine: null,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    ...thread,
  });
}

test("a thread on a removed line is found on the old side, three rows of context above it, the rows after it left out", () => {
  assert.deepEqual(previewOf({ originalLine: 24, side: DIFF_SIDE.LEFT }), {
    patch: [
      ...HEAD,
      "@@ -21,4 +21,3 @@ function expire()",
      " const b = 2;",
      " const c = 3;",
      " const d = 4;",
      "-  return late;",
      "",
    ].join("\n"),
    selected: { start: 24, side: "deletions", end: 24, endSide: "deletions" },
  });
});

test("a range across both sides runs from its first line on the one to its last on the other", () => {
  const preview = previewOf({
    originalLine: 24,
    originalStartLine: 24,
    side: DIFF_SIDE.RIGHT,
    startSide: DIFF_SIDE.LEFT,
  });
  assert.equal(
    preview?.patch.split("\n").slice(3).join("\n"),
    [
      "@@ -21,4 +21,4 @@ function expire()",
      " const b = 2;",
      " const c = 3;",
      " const d = 4;",
      "-  return late;",
      "+  return soon;",
      "",
    ].join("\n"),
  );
  assert.deepEqual(preview?.selected, {
    start: 24,
    side: "deletions",
    end: 24,
    endSide: "additions",
  });
});

test("a thread on a file's first added lines previews them alone, the old side written empty as git writes it", () => {
  const preview = previewOf({
    diffHunk: "@@ -0,0 +1,3 @@\n+one\n+two\n+three",
    originalLine: 2,
    originalStartLine: 1,
  });
  assert.equal(
    preview?.patch.split("\n").slice(3).join("\n"),
    ["@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n"),
  );
  assert.deepEqual(preview?.selected, {
    start: 1,
    side: "additions",
    end: 2,
    endSide: "additions",
  });
});

test("a line the hunk does not hold previews the hunk's end, where GitHub ends it, and a hunk with no header previews nothing", () => {
  assert.equal(previewOf({ originalLine: 99 })?.patch.split("\n").at(-2), " }");
  assert.equal(previewOf({ diffHunk: "" }), undefined);
  assert.equal(previewOf({ diffHunk: "not a diff" }), undefined);
});

/** A thread on `path` at `line` on the new side, keyed by its one comment's page. */
function threadAt(path: string, line: number | null, url: string) {
  return {
    path,
    line,
    startLine: null,
    originalLine: 7,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    diffHunk: HUNK,
    resolved: false,
    outdated: line === null,
    comments: [
      {
        by: { login: "octo", bot: false },
        html: null,
        body: "Why?",
        at: 1,
        url,
      },
    ],
    more: 0,
  };
}

/** The changed file the threads are on: one hunk, old lines 3 to 5 and new lines 3 to 6, line 4 changed and a line added. */
const FILE_A = {
  path: "src/a.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch:
    "@@ -3,3 +3,4 @@\n const c = 3;\n-const d = 4;\n+const d = 5;\n+const e = 6;\n const f = 7;",
};

const R = "https://github.com/acme/relay/pull/7#r";

test("a file's threads stand under the lines its diff draws, on the side they count on, and every other above its diff", () => {
  const { placed, above } = threadsOn(
    [
      { ...threadAt("src/a.ts", 4, `${R}1`), side: DIFF_SIDE.LEFT },
      threadAt("src/a.ts", 5, `${R}2`),
      threadAt("src/a.ts", null, `${R}3`),
      threadAt("src/a.ts", 120, `${R}4`),
      threadAt("src/b.ts", 2, `${R}5`),
      { ...threadAt("src/a.ts", 5, "unused"), comments: [] },
    ],
    FILE_A,
  );

  assert.deepEqual(
    placed.map(({ key, side, line }) => [key, side, line]),
    [
      [`${R}1`, "deletions", 4],
      [`${R}2`, "additions", 5],
    ],
  );
  assert.deepEqual(
    above.map(({ key, line }) => [key, line]),
    [
      [`${R}3`, 7],
      [`${R}4`, 120],
    ],
    "an outdated thread, and one on a line no hunk shows",
  );
});

test("every thread on a file whose diff is not drawn stands above where its diff would", () => {
  const { placed, above } = threadsOn([threadAt("src/a.ts", 4, `${R}1`)], {
    ...FILE_A,
    patch: null,
    omitted: PATCH_OMITTED.BINARY,
  });

  assert.deepEqual(placed, []);
  assert.deepEqual(
    above.map(({ key }) => key),
    [`${R}1`],
  );
});

/** A changed file, modified, a few lines changed, unless told otherwise. */
function changed(
  path: string,
  overrides: Partial<CodingAgentChangedFile> = {},
): CodingAgentChangedFile {
  return {
    path,
    previousPath: null,
    status: CHANGED_FILE_STATUS.MODIFIED,
    additions: 2,
    deletions: 1,
    omitted: null,
    patch: "@@ -1 +1 @@\n-a\n+b",
    ...overrides,
  };
}

test("the files are listed as the tree lists them: folders first at each level, dotted names first, then by name whatever its case", () => {
  const paths = [
    "src/b.ts",
    "README.md",
    "src/A.ts",
    ".github/ci.yml",
    "src/lib/x.ts",
    ".env",
    "docs/a.md",
  ];

  assert.deepEqual(
    treeOrder(paths.map((path) => changed(path))).map((file) => file.path),
    [".github/ci.yml", "docs/a.md", "src/lib/x.ts", "src/A.ts", "src/b.ts", ".env", "README.md"],
  );
});

test("a filter keeps the files whose path holds it whatever its case, as the tree's search does, not the path one moved from, and nothing but spaces keeps every file", () => {
  const files = [
    changed("src/seats.ts"),
    changed("src/plan.ts", {
      previousPath: "billing/plan.ts",
      status: CHANGED_FILE_STATUS.RENAMED,
    }),
    changed("README.md"),
  ];

  assert.deepEqual(
    filterFiles(files, " SEATS ").map((file) => file.path),
    ["src/seats.ts"],
  );
  assert.deepEqual(
    filterFiles(files, "PLAN").map((file) => file.path),
    ["src/plan.ts"],
  );
  assert.deepEqual(filterFiles(files, "billing"), []);
  assert.equal(filterFiles(files, "  ").length, 3);
});

test("a deleted file, a lockfile, and a file of more than a thousand changed lines start folded; a file with no hunks never does", () => {
  assert.equal(startsCollapsed(changed("src/seats.ts")), false);
  assert.equal(
    startsCollapsed(changed("src/old.ts", { status: CHANGED_FILE_STATUS.DELETED })),
    true,
  );
  assert.equal(startsCollapsed(changed("apps/web/package-lock.json")), true);
  assert.equal(startsCollapsed(changed("ios/Podfile.lock")), true);
  assert.equal(startsCollapsed(changed("src/big.ts", { additions: 900, deletions: 101 })), true);
  assert.equal(startsCollapsed(changed("src/big.ts", { additions: 900, deletions: 100 })), false);
  assert.equal(
    startsCollapsed(changed("pnpm-lock.yaml", { patch: null, omitted: PATCH_OMITTED.TOO_LARGE })),
    false,
  );
});

/** A pick of lines on the sides given, from `start` to `end`, as the gutter's + tells it. */
function picked(
  start: number,
  end: number,
  side: (typeof DIFF_SELECTION_SIDE)[keyof typeof DIFF_SELECTION_SIDE] = DIFF_SELECTION_SIDE.ADDITIONS,
  endSide = side,
) {
  return { start, side, end, endSide };
}

test("a comment's lines are GitHub's: in the order the diff draws them however they were picked, one line where both ends are one row, and each end on its own side", () => {
  assert.deepEqual(commentLines(FILE_A, picked(5, 3)), {
    line: 5,
    side: DIFF_SIDE.RIGHT,
    startLine: 3,
    startSide: DIFF_SIDE.RIGHT,
  });
  assert.deepEqual(commentLines(FILE_A, picked(4, 4, DIFF_SELECTION_SIDE.DELETIONS)), {
    line: 4,
    side: DIFF_SIDE.LEFT,
  });
  assert.deepEqual(
    commentLines(
      FILE_A,
      picked(5, 4, DIFF_SELECTION_SIDE.ADDITIONS, DIFF_SELECTION_SIDE.DELETIONS),
    ),
    { line: 5, side: DIFF_SIDE.RIGHT, startLine: 4, startSide: DIFF_SIDE.LEFT },
  );
  assert.deepEqual(
    commentLines(FILE_A, picked(5, 5, DIFF_SELECTION_SIDE.DELETIONS)),
    { line: 5, side: DIFF_SIDE.LEFT },
    "an unchanged line counts on the old side too",
  );
  assert.equal(
    commentLinesLabel({ line: 5, side: DIFF_SIDE.RIGHT, startLine: 3, startSide: DIFF_SIDE.RIGHT }),
    "lines 3–5",
  );
  assert.equal(
    commentLinesLabel({ line: 5, side: DIFF_SIDE.RIGHT, startLine: 4, startSide: DIFF_SIDE.LEFT }),
    "lines L4–R5",
  );
});

test("no comment is offered where GitHub takes none: a line no row stands for, a range across two hunks, or a file that draws no lines of its own", () => {
  const twoHunks = changed("src/two.ts", {
    patch: "@@ -1,2 +1,2 @@\n-a\n+b\n c\n@@ -10,2 +10,2 @@\n x\n-y\n+z",
  });

  assert.equal(commentLines(FILE_A, picked(9, 9)), undefined);
  assert.equal(commentLines(FILE_A, picked(6, 6, DIFF_SELECTION_SIDE.DELETIONS)), undefined);
  assert.equal(commentLines(twoHunks, picked(1, 11)), undefined);
  assert.equal(
    commentLines(changed("logo.png", { patch: null, omitted: PATCH_OMITTED.BINARY }), picked(1, 1)),
    undefined,
  );
});

/** A file changed from `before` to `after`, its patch the hunks GitHub sends: from the first `@@` on, three lines of context. */
function changedFrom(
  before: string,
  after: string,
  overrides: Partial<CodingAgentChangedFile> = {},
): CodingAgentChangedFile {
  const whole = createPatch("src/a.ts", before, after, "", "", { context: 3 });
  return changed("src/a.ts", { patch: whole.slice(whole.indexOf("@@")), ...overrides });
}

/** Lines numbered from 1 to `count`, each ending in a newline. */
function numbered(count: number, from = 1): string[] {
  return Array.from({ length: count }, (_, at) => `line ${from + at}`);
}

test("a changed file's text before is its text after with each hunk turned back, wherever its hunks stand", () => {
  const lines = numbered(40);
  const cases: Array<[string, string[]]> = [
    ["a line changed between others", lines.map((line, at) => (at === 20 ? "changed" : line))],
    ["the first line changed", lines.map((line, at) => (at === 0 ? "first" : line))],
    ["the last line changed", lines.map((line, at) => (at === 39 ? "last" : line))],
    ["lines added alone", [...lines.slice(0, 10), "new a", "new b", ...lines.slice(10)]],
    ["lines removed alone", [...lines.slice(0, 10), ...lines.slice(14)]],
    [
      "two hunks far apart",
      lines.map((line, at) => (at === 3 ? "three" : at === 33 ? "thirty-three" : line)),
    ],
  ];
  const before = `${lines.join("\n")}\n`;
  for (const [name, afterLines] of cases) {
    const after = `${afterLines.join("\n")}\n`;
    assert.deepEqual(textsOf(changedFrom(before, after), after), { before, after }, name);
  }
});

test("a file ending without a newline, before or after, is turned back to the ending it had", () => {
  const base = numbered(12);
  const pairs: Array<[string, string, string]> = [
    ["the newline taken away", `${base.join("\n")}\n`, `${base.join("\n")}`],
    ["the newline added", `${base.join("\n")}`, `${base.join("\n")}\n`],
    ["neither ending in one", `${base.join("\n")}`, `${[...base.slice(0, 11), "end"].join("\n")}`],
    [
      "the end changed far from the hunk",
      `${base.join("\n")}`,
      `${["start", ...base.slice(1)].join("\n")}`,
    ],
  ];
  for (const [name, before, after] of pairs) {
    assert.deepEqual(textsOf(changedFrom(before, after), after), { before, after }, name);
  }
});

test("a file moved with changes is turned back too, and one whose lines between hunks are not drawn is not", () => {
  const before = `${numbered(20).join("\n")}\n`;
  const after = before.replace("line 10", "ten");
  const moved = changedFrom(before, after, {
    status: CHANGED_FILE_STATUS.RENAMED,
    previousPath: "src/old.ts",
  });
  assert.deepEqual(textsOf(moved, after), { before, after });
  for (const status of [CHANGED_FILE_STATUS.ADDED, CHANGED_FILE_STATUS.DELETED]) {
    assert.equal(textsOf(changedFrom(before, after, { status }), after), undefined, status);
  }
  const omitted = changedFrom(before, after, { patch: null, omitted: PATCH_OMITTED.TOO_LARGE });
  assert.equal(textsOf(omitted, after), undefined);
});

test("a text after that is not the one the patch was made against is not turned back, so no line of another commit is drawn", () => {
  const before = `${numbered(30).join("\n")}\n`;
  const after = before.replace("line 15", "fifteen");
  const file = changedFrom(before, after);
  assert.equal(
    textsOf(file, after.replace("line 13", "pushed since")),
    undefined,
    "a context line differs",
  );
  assert.equal(
    textsOf(file, after.replace("fifteen", "sixteen")),
    undefined,
    "an added line differs",
  );
  assert.equal(
    textsOf(file, numbered(5).join("\n")),
    undefined,
    "the file is shorter than its hunks",
  );
});

test("a file whose lines end in a carriage return is turned back with its line endings as they were", () => {
  const before = "a\r\nb\r\nc\r\nd\r\ne\r\n";
  const after = "a\r\nb\r\nC\r\nd\r\ne\r\n";
  const patch = "@@ -1,5 +1,5 @@\n a\r\n b\r\n-c\r\n+C\r\n d\r\n e\r";
  assert.deepEqual(textsOf(changed("src/a.ts", { patch }), after), { before, after });
});

test("a file's contents are named as git names a blob, which GitHub names a changed file's contents by", async () => {
  assert.equal(await blobShaOf("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
});

test("a suggestion starts from the head's own words of the lines a comment is on, and none is offered where either end counts on the old side", () => {
  assert.equal(
    suggestedLines(FILE_A, {
      line: 5,
      side: DIFF_SIDE.RIGHT,
      startLine: 3,
      startSide: DIFF_SIDE.RIGHT,
    }),
    "const c = 3;\nconst d = 5;\nconst e = 6;",
  );
  assert.equal(suggestedLines(FILE_A, { line: 6, side: DIFF_SIDE.RIGHT }), "const f = 7;");
  assert.equal(suggestedLines(FILE_A, { line: 4, side: DIFF_SIDE.LEFT }), undefined);
  assert.equal(
    suggestedLines(FILE_A, {
      line: 5,
      side: DIFF_SIDE.RIGHT,
      startLine: 4,
      startSide: DIFF_SIDE.LEFT,
    }),
    undefined,
  );
  assert.equal(suggestedLines(FILE_A, { line: 9, side: DIFF_SIDE.RIGHT }), undefined);
});

test("a line's place is its row's in the order the diff draws them, so an added row drawn before a removed one stands first, and a line no row holds has none", () => {
  const mixed = changed("src/m.ts", { patch: "@@ -1,4 +1,4 @@\n a\n+b\n c\n-d\n e" });

  assert.equal(rowPlace(mixed, DIFF_SELECTION_SIDE.ADDITIONS, 2), 1);
  assert.equal(rowPlace(mixed, DIFF_SELECTION_SIDE.DELETIONS, 3), 3);
  assert.equal(
    rowPlace(mixed, DIFF_SELECTION_SIDE.DELETIONS, 2),
    2,
    "an unchanged row holds the old side's line",
  );
  assert.equal(rowPlace(mixed, DIFF_SELECTION_SIDE.ADDITIONS, 9), undefined);
});
