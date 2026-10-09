import assert from "node:assert/strict";
import { test } from "vitest";
import { TOOL_BLOCK } from "../ai-elements/tool";
import { patchPaths, planCardTitle, stripAnsi, TOOL_GLYPH, toolCallView } from "./tool-call-model";

const ESCAPE = String.fromCharCode(27);

test("a command's row is the command behind a prompt, and its answer reads as a terminal showed it", () => {
  const view = toolCallView({
    tool: "bash",
    input: { command: "pnpm check" },
    output: {
      status: "completed",
      exitCode: 2,
      stdout: `${ESCAPE}[32mall green${ESCAPE}[0m\n`,
      stderr: "one warning\n",
      truncated: true,
    },
  });
  assert.equal(view.glyph, TOOL_GLYPH.TERMINAL);
  assert.deepEqual(view.summary, { label: undefined, code: "$ pnpm check" });
  assert.deepEqual(view.input, { kind: TOOL_BLOCK.COMMAND, text: "pnpm check" });
  assert.deepEqual(view.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "all green\none warning\nexit 2\n(output truncated)",
  });
});

test("a command still running has its row and its command, and no answer yet", () => {
  const view = toolCallView({ tool: "bash", input: { command: "sleep 1" }, output: undefined });
  assert.equal(view.summary.code, "$ sleep 1");
  assert.equal(view.output, undefined);
});

test("a file read and a search say the path and the pattern, and answer with the words under them", () => {
  const read = toolCallView({
    tool: "read_file",
    input: { filePath: "/workspace/repository/README.md", limit: 20 },
    output: { content: "# Luke\n" },
  });
  assert.equal(read.glyph, TOOL_GLYPH.FILE);
  assert.deepEqual(read.summary, { label: "Read", code: "/workspace/repository/README.md" });
  assert.deepEqual(read.output, { kind: TOOL_BLOCK.TEXT, text: "# Luke\n" });

  const grep = toolCallView({
    tool: "grep",
    input: { pattern: "invit", path: "/workspace/repository" },
    output: {
      content: "a.ts:1: invite",
      matchCount: 1,
      path: "/workspace/repository",
      truncated: false,
    },
  });
  assert.equal(grep.glyph, TOOL_GLYPH.SEARCH);
  assert.deepEqual(grep.summary, { label: "Searched", code: "invit" });
  assert.deepEqual(grep.output, { kind: TOOL_BLOCK.TEXT, text: "a.ts:1: invite" });
});

test("a patch names the first file it touches and how many more, carries the patch to draw as a diff, and answers with the files it changed", () => {
  const patchText = [
    "*** Begin Patch",
    "*** Update File: apps/web/a.ts",
    "@@",
    "-old",
    "+new",
    "*** Add File: apps/web/b.ts",
    "+export const b = 1;",
    "*** End Patch",
  ].join("\n");
  const view = toolCallView({
    tool: "apply_patch",
    input: { root: "/workspace/repository", patchText },
    output: {
      diagnostics: [],
      files: [
        { operation: "update", path: "apps/web/a.ts" },
        { operation: "add", path: "apps/web/b.ts" },
      ],
    },
  });
  assert.equal(view.glyph, TOOL_GLYPH.EDIT);
  assert.deepEqual(view.summary, { label: "Edited", code: "apps/web/a.ts +1" });
  assert.deepEqual(view.input, { kind: TOOL_BLOCK.PATCH, text: patchText });
  assert.deepEqual(view.output, {
    kind: TOOL_BLOCK.TEXT,
    text: "update apps/web/a.ts\nadd apps/web/b.ts",
  });
  assert.deepEqual(patchPaths(patchText), ["apps/web/a.ts", "apps/web/b.ts"]);
});

test("a tool this build does not know is named as it is, with its input and answer as JSON", () => {
  const view = toolCallView({
    tool: "gh",
    input: { args: ["pr", "create"] },
    output: { url: "https://github.com/acme/relay/pull/7" },
  });
  assert.equal(view.glyph, TOOL_GLYPH.GENERIC);
  assert.deepEqual(view.summary, { label: "gh", code: '{"args":["pr","create"]}' });
  assert.deepEqual(view.input, {
    kind: TOOL_BLOCK.JSON,
    text: '{\n  "args": [\n    "pr",\n    "create"\n  ]\n}',
  });
  assert.deepEqual(view.output, {
    kind: TOOL_BLOCK.JSON,
    text: '{\n  "url": "https://github.com/acme/relay/pull/7"\n}',
  });
  // An answer that is already words is shown as they are.
  assert.deepEqual(toolCallView({ tool: "gh", input: undefined, output: "done" }).output, {
    kind: TOOL_BLOCK.JSON,
    text: "done",
  });
});

test("a command's answer that is not a terminal's envelope falls back to its JSON", () => {
  const view = toolCallView({
    tool: "bash",
    input: { command: "true" },
    output: {
      status: "unknown",
      reason: "The turn ended before the call answered; it may have run.",
    },
  });
  assert.equal(view.output?.kind, TOOL_BLOCK.JSON);
  assert.match(view.output?.text ?? "", /"reason": "The turn ended/u);
});

test("terminal escapes are taken out of words, colours and titles alike", () => {
  assert.equal(stripAnsi(`${ESCAPE}[1;31mred${ESCAPE}[0m plain`), "red plain");
  assert.equal(stripAnsi(`${ESCAPE}]0;title${String.fromCharCode(7)}after`), "after");
  assert.equal(stripAnsi("no escapes"), "no escapes");
});

test("a plan's card is titled by its first heading, or its first line of words", () => {
  assert.equal(planCardTitle("# Teammate invitations\n\nInvite by email."), "Teammate invitations");
  assert.equal(planCardTitle("\n\nInvite by email.\n# Later"), "Invite by email.");
  assert.equal(planCardTitle("   "), "");
});
