import assert from "node:assert/strict";
import { unparsedWire } from "@luke/wire";
import type { MessageStreamEvent } from "eve/client";
import type { ToolContext, ToolDefinition } from "eve/tools";
import { test } from "vitest";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { deepeningFirst, deepensCheckout, deepensSandbox } from "./deepen.js";
import { CODER_TOOL } from "./tool-set.js";

/**
 * Which of a coding agent's calls deepen its shallow checkout before they
 * run: every write, and every shell command but a plain read; and the
 * tool that deepens through the door it is handed the moment it opens its
 * sandbox, and only then.
 */

const bash = (command: string) => deepensCheckout(CODER_TOOL.BASH, unparsedWire({ command }));

test("a write, a pull request, and a shell command that may reach git or a script deepen the checkout; a plain read does not", () => {
  for (const tool of [
    CODER_TOOL.WRITE_FILE,
    CODER_TOOL.APPLY_PATCH,
    CODER_TOOL.OPEN_PULL_REQUEST,
  ]) {
    assert.equal(deepensCheckout(tool, unparsedWire({})), true, tool);
  }
  for (const tool of [
    CODER_TOOL.READ_FILE,
    CODER_TOOL.GLOB,
    CODER_TOOL.GREP,
    CODER_TOOL.SHOW_CODE,
    CODER_TOOL.SHOW_PAGE,
  ]) {
    assert.equal(deepensCheckout(tool, unparsedWire({ path: "src/index.ts" })), false, tool);
  }
  for (const read of [
    "ls -la",
    "cat package.json | head -40",
    "grep -rn invite src && wc -l src/members/invite.ts",
    "find . -name '*.ts' | sort | uniq",
    "LC_ALL=C sed -n '1,40p' README.md",
    "cd packages/service; rg 'show_code' -l",
    "grep -rn invite src 2>/dev/null | head",
    "ls missing 2>&1",
    "sed -n '1,20p' a.ts",
  ]) {
    assert.equal(bash(read), false, read);
  }
  for (const write of [
    "git log --oneline -5",
    "git push -u origin feat/x",
    "gh pr checks 12 --watch",
    "ls && git status",
    "pnpm check:affected",
    "npm test",
    "cat $(git ls-files | head -1)",
    "find . -name '*.ts' -exec git blame {} \\;",
    "bash scripts/check.sh",
    "echo change > src/a.ts",
    "cat a.ts >> b.ts",
    "sed -i 's/old/new/' src/app.ts",
    "sed -ni 's/old/new/p' src/app.ts",
    "find . -name '*.tmp' -delete",
    "find . -exec touch x \\;",
  ]) {
    assert.equal(bash(write), true, write);
  }
  // A shell call the model sent without a command is taken for one that writes.
  assert.equal(deepensCheckout(CODER_TOOL.BASH, unparsedWire({})), true);
});

test("a session's event deepened its checkout where it requested a call that deepens", () => {
  const requested = (
    toolName: string,
    input: { readonly [key: string]: string },
  ): MessageStreamEvent =>
    stampedEveEvent(
      {
        type: "actions.requested",
        data: {
          turnId: "turn_0",
          sequence: 0,
          stepIndex: 0,
          actions: [{ kind: "tool-call", callId: "call_1", toolName, input }],
        },
      },
      0,
    );
  assert.equal(deepensSandbox(requested(CODER_TOOL.APPLY_PATCH, { patchText: "" })), true);
  assert.equal(deepensSandbox(requested(CODER_TOOL.BASH, { command: "git log" })), true);
  assert.equal(deepensSandbox(requested(CODER_TOOL.BASH, { command: "ls" })), false);
  assert.equal(deepensSandbox(requested(CODER_TOOL.READ_FILE, { path: "a.ts" })), false);
});

/** A tool context whose sandbox door records each opening, and a deepen door recording each deepen, both in one log. */
function contextLogging(log: string[]): ToolContext {
  const sandbox = { id: "sandbox" };
  // SAFETY: the wrapped tool reads nothing of the context but its sandbox door, which this double answers.
  return {
    getSandbox: async () => {
      log.push("open");
      return sandbox;
    },
  } as unknown as ToolContext;
}

test("a tool that writes deepens once, the moment it first opens its sandbox, and a read opens it as it was", async () => {
  const log: string[] = [];
  const tool: ToolDefinition<{ readonly command: string }, string> = {
    description: "A shell.",
    inputSchema: { type: "object" },
    execute: async (_input, ctx) => {
      log.push("run");
      await ctx.getSandbox();
      await ctx.getSandbox();
      return "done";
    },
  };
  const deepening = deepeningFirst(CODER_TOOL.BASH, tool, async () => {
    log.push("deepen");
  });

  assert.equal(await deepening.execute({ command: "git log" }, contextLogging(log)), "done");
  assert.deepEqual(log, ["run", "deepen", "open", "open"]);

  log.length = 0;
  await deepening.execute({ command: "ls" }, contextLogging(log));
  assert.deepEqual(log, ["run", "open", "open"]);
});

test("a deepen that fails fails the call before its sandbox is handed over", async () => {
  const log: string[] = [];
  const tool: ToolDefinition<{ readonly path: string }, void> = {
    description: "A file write.",
    inputSchema: { type: "object" },
    execute: async (_input, ctx) => {
      await ctx.getSandbox();
      log.push("wrote");
    },
  };
  const deepening = deepeningFirst(CODER_TOOL.WRITE_FILE, tool, async () => {
    throw new Error("the repository could not be checked out.");
  });

  await assert.rejects(
    async () => deepening.execute({ path: "a.ts" }, contextLogging(log)),
    /could not be checked out/u,
  );
  assert.deepEqual(log, []);
});
