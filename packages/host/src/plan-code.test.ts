import assert from "node:assert/strict";
import type { ShownCode } from "@sidecar/hosted/plan-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import { highlightCode } from "./plan-code.js";

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
