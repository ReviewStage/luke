import assert from "node:assert/strict";
import type { ShownCode } from "@sidecar/hosted/plan-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import { codeExcerpt, highlightCode } from "./plan-code.js";

const INVITE = [
  'import { db } from "./db.js";',
  "",
  "export async function acceptInvite(token: string) {",
  "  const invite = await db.invites.find(token);",
  "  return invite;",
  "}",
];

/** Code as the service sends it: the window the checkout answered for the lines pointed at. */
function shown(path: string, lines: readonly string[], firstLine = 1): ShownCode {
  return {
    ref: { path, startLine: 3, endLine: 4 },
    repository: "acme/relay",
    firstLine,
    lineCount: 60,
    lines,
  };
}

/** The drawn lines as the text they read, run by run. */
function textOf(code: PlanCode): string[] {
  return code.lines.map((line) => line.map((token) => token.text).join(""));
}

test("the lines the service sent are drawn whole and coloured as the file's language in both appearances, under their place and repository", () => {
  const code = highlightCode(shown("src/invite.ts", INVITE, 40));

  assert.deepEqual(code.ref, { path: "src/invite.ts", startLine: 3, endLine: 4 });
  assert.equal(code.repository, "acme/relay");
  assert.equal(code.firstLine, 40);
  assert.equal(code.lineCount, 60);
  assert.deepEqual(textOf(code), INVITE);
  const keyword = code.lines[2]?.find((token) => token.text.includes("export"));
  assert.ok(keyword?.color, "a keyword is drawn in a colour of its own");
  assert.ok(keyword.lightColor, "and in a colour of its own in the light appearance");
  assert.notEqual(keyword.lightColor, keyword.color);
  assert.deepEqual(code.lines[1], [], "an empty line carries no run");
});

test("a file of no language the highlighter knows is drawn plain, one run per line", () => {
  const code = highlightCode(shown("notes.txt", ["first line", "", "third line"]));

  assert.deepEqual(code.lines, [[{ text: "first line" }], [], [{ text: "third line" }]]);
});

test("a card's part of a window is the lines pointed at with three of the file either side, kept within the window, or a whole file's head", () => {
  const numbered = Array.from({ length: 200 }, (_, at) => `line ${40 + at}`);
  const window = { ...shown("src/invite.ts", numbered, 40), lineCount: 400 };

  const middle = codeExcerpt({
    ...window,
    ref: { path: "src/invite.ts", startLine: 100, endLine: 101 },
  });
  assert.equal(middle.firstLine, 97);
  assert.deepEqual(middle.lines, [
    "line 97",
    "line 98",
    "line 99",
    "line 100",
    "line 101",
    "line 102",
    "line 103",
    "line 104",
  ]);
  assert.equal(middle.lineCount, 400, "the whole file's length is kept");

  const top = codeExcerpt({
    ...window,
    ref: { path: "src/invite.ts", startLine: 40, endLine: 40 },
  });
  assert.equal(top.firstLine, 40);
  assert.deepEqual(top.lines, ["line 40", "line 41", "line 42", "line 43"]);

  const head = codeExcerpt({ ...window, ref: { path: "src/invite.ts" } });
  assert.equal(head.firstLine, 40);
  assert.equal(head.lines.length, 24);
});

test("lines pointed at past the window, as past a short file's end, draw the window's head rather than nothing", () => {
  const short = { ...shown("src/invite.ts", ["a", "b", "c"], 1), lineCount: 3 };

  const past = codeExcerpt({
    ...short,
    ref: { path: "src/invite.ts", startLine: 100, endLine: 101 },
  });

  assert.equal(past.firstLine, 1);
  assert.deepEqual(past.lines, ["a", "b", "c"]);
});
