import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { ClaudeCodeSessionAdapter } from "./adapter.js";

const TEST_SESSION_ID = "3f9a1b2c-4d5e-6789-abcd-ef0123456789";
const CLAUDE_PROJECTS_DIRECTORY = "projects";

function readClaudeSessionTranscript(request: {
  claudeHome: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}): Promise<string | undefined> {
  return new ClaudeCodeSessionAdapter({
    claudeHome: request.claudeHome,
    transcriptReadTailBytes: request.readTailBytes,
    transcriptMaximumRenderedLength: request.maximumRenderedLength,
  }).readTranscript(request.providerSessionId);
}

async function temporaryClaudeHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-claude-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeTranscript(
  claudeHome: string,
  sessionId: string,
  records: readonly ParsedJsonObject[],
): Promise<void> {
  const projectDirectory = path.join(claudeHome, CLAUDE_PROJECTS_DIRECTORY, "-Users-test-luke");
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.writeFile(
    path.join(projectDirectory, `${sessionId}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("renders a session's turns as a bounded conversation, newest included", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeTranscript(claudeHome, TEST_SESSION_ID, [
    { type: "user", message: { role: "user", content: "Fix the flaky test" } },
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at the failure now." },
          { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
        ],
      },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", content: "1 failing: retries" }] },
      toolUseResult: {},
    },
    {
      type: "assistant",
      message: { stop_reason: "end_turn", content: [{ type: "text", text: "Fixed and green." }] },
    },
  ]);

  const rendered = await readClaudeSessionTranscript({
    claudeHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(
    rendered,
    [
      "Developer: Fix the flaky test",
      "Claude: Looking at the failure now.",
      "→ Bash: pnpm test",
      "← 1 failing: retries",
      "Claude: Fixed and green.",
    ].join("\n"),
  );
});

test("keeps the newest turns when the rendering is cut, and says so", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const records = Array.from({ length: 40 }, (_, index) => ({
    type: "user",
    message: { role: "user", content: `prompt number ${index} ${"x".repeat(40)}` },
  }));
  await writeTranscript(claudeHome, TEST_SESSION_ID, records);

  const rendered = await readClaudeSessionTranscript({
    claudeHome,
    providerSessionId: TEST_SESSION_ID,
    maximumRenderedLength: 400,
  });

  assert.ok(rendered);
  assert.ok(rendered.startsWith("[earlier turns omitted]\n"));
  assert.ok(rendered.length <= 400 + "[earlier turns omitted]\n".length);
  assert.ok(rendered.includes("prompt number 39"), "the newest turn survives the cut");
  assert.ok(!rendered.includes("prompt number 0 "), "the oldest turn is what goes");
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The cut lands on a line, so no half prompt poses as a whole one.
  for (const line of rendered.split("\n").slice(1)) {
    assert.ok(line.startsWith("Developer: "), `a cut line survived: ${line}`);
  }
});

test("reads nothing for a session that has no transcript file", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeTranscript(claudeHome, TEST_SESSION_ID, [
    { type: "user", message: { content: "hello" } },
  ]);

  const rendered = await readClaudeSessionTranscript({
    claudeHome,
    providerSessionId: "0000aaaa-1111-2222-3333-444455556666",
  });

  assert.equal(rendered, undefined);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("refuses an id outside the shape Claude Code mints, never treating it as a path", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);

  const rendered = await readClaudeSessionTranscript({
    claudeHome,
    providerSessionId: "../../../etc/passwd",
  });

  assert.equal(rendered, undefined);
});

test("reports a spent error and a run's result in the session's own words", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeTranscript(claudeHome, TEST_SESSION_ID, [
    { type: "system", subtype: "api_error", error: { message: "rate limited" } },
    { type: "result", result: "Done: 3 files changed." },
  ]);

  const rendered = await readClaudeSessionTranscript({
    claudeHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, ["Error: rate limited", "Result: Done: 3 files changed."].join("\n"));
});

test("reads a tool's answer from the bookkeeping shape that has no blocks", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeTranscript(claudeHome, TEST_SESSION_ID, [
    // The shape Claude Code often writes: toolUseResult only, no content
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // blocks at all — which must render as the tool's answer, not vanish.
    { type: "user", toolUseResult: { stdout: "2 passed, 0 failed" } },
    { type: "user", toolUseResult: "plain string result" },
  ]);

  const rendered = await readClaudeSessionTranscript({
    claudeHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, ["← 2 passed, 0 failed", "← plain string result"].join("\n"));
});
