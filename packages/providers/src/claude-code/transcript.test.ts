import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchRead, OMISSION_MARKER } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { type TestContext, test } from "vitest";
import {
  boundedTranscript,
  jsonlTranscriptReader,
  TRANSCRIPT_BOUNDS,
} from "../shared/jsonl-transcript.js";
import { readTail, tailRecords } from "../shared/local-files.js";
import { claudeCodePlugin } from "./index.js";
import { claudeTranscriptFilePath, linesFromClaudeRecord } from "./transcript.js";

/**
 * The reader the plugin builds, built here too: what is under test is where
 * a session's records live and what one of them renders as, which is all a
 * provider supplies.
 */
function claudeTranscripts(claudeHome: string) {
  return jsonlTranscriptReader({
    locate: (providerSessionId) => claudeTranscriptFilePath(claudeHome, providerSessionId),
    lines: linesFromClaudeRecord,
  });
}

async function readClaudeSessionTranscript(request: {
  claudeHome: string;
  providerSessionId: string;
}): Promise<string | undefined> {
  const result = await claudeTranscripts(request.claudeHome).read(request.providerSessionId);
  return result.status === "accepted" ? result.transcript : undefined;
}

/** The rendered lines a session's records yield, for a test of the cut itself. */
async function claudeTranscriptLines(
  claudeHome: string,
  providerSessionId: string,
): Promise<readonly string[]> {
  const filePath = await claudeTranscriptFilePath(claudeHome, providerSessionId);
  assert.ok(filePath);
  return tailRecords(await readTail(filePath, TRANSCRIPT_BOUNDS.READ_TAIL_BYTES)).flatMap(
    linesFromClaudeRecord,
  );
}

const TEST_SESSION_ID = "3f9a1b2c-4d5e-6789-abcd-ef0123456789";
const CLAUDE_PROJECTS_DIRECTORY = "projects";

async function temporaryClaudeHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-claude-transcript-"));
  t.onTestFinished(async () => {
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

  // The cut is `boundedTranscript`'s, so it is asked for where it lives: a
  // read the build performs never cuts a rendering at all.
  const rendered = boundedTranscript(await claudeTranscriptLines(claudeHome, TEST_SESSION_ID), 400);

  assert.ok(rendered);
  assert.ok(rendered.length <= 400 + OMISSION_MARKER.length + 1);
});

test("renders every line uncut when no rendered length is asked for", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const records = Array.from({ length: 400 }, (_, index) => ({
    type: "user",
    message: { role: "user", content: `prompt number ${index} ${"x".repeat(40)}` },
  }));
  await writeTranscript(claudeHome, TEST_SESSION_ID, records);

  const rendered = await readClaudeSessionTranscript({
    claudeHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.ok(rendered);
  assert.ok(rendered.length > 8_000, "the old whole-rendering cap no longer applies");
  assert.equal(rendered.split("\n").length, 400);
});

// A message is rendered whole, line breaks and all; a tool's answer is the
// gist, cut to its own bound.
test("renders a long message whole and keeps a tool answer short", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const report = Array.from({ length: 30 }, (_, index) => `- ${index}: ${"x".repeat(100)}`).join(
    "\n",
  );
  await writeTranscript(claudeHome, TEST_SESSION_ID, [
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: report }] },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "y".repeat(1_000) }],
      },
    },
  ]);

  const lines = await claudeTranscriptLines(claudeHome, TEST_SESSION_ID);

  assert.equal(lines.length, 2);
  assert.equal(lines[0], `Claude: ${report}`);
  assert.equal(lines[1]?.length, "← ".length + TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
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

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reads what a session's transcript gained since the cursor an earlier read minted", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const plugin = claudeCodePlugin({ claudeHome });
  await writeTranscript(claudeHome, TEST_SESSION_ID, [
    { type: "user", message: { role: "user", content: "Fix the flaky test" } },
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "Looking at the failure now." }] },
    },
  ]);

  const first = await dispatchRead(plugin, "transcriptSince", TEST_SESSION_ID);
  assert.equal(first.status, "accepted");
  if (first.status !== "accepted") return;
  assert.equal(
    first.text,
    ["Developer: Fix the flaky test", "Claude: Looking at the failure now."].join("\n"),
  );
  assert.equal(first.truncated, false);
  assert.ok(first.cursor);

  const transcriptPath = path.join(
    claudeHome,
    CLAUDE_PROJECTS_DIRECTORY,
    "-Users-test-luke",
    `${TEST_SESSION_ID}.jsonl`,
  );
  await fs.appendFile(
    transcriptPath,
    `${JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", content: [{ type: "text", text: "Fixed and green." }] },
    })}\n`,
  );

  const second = await dispatchRead(plugin, "transcriptSince", TEST_SESSION_ID, first.cursor);
  assert.equal(second.status, "accepted");
  if (second.status !== "accepted") return;
  assert.equal(second.text, "Claude: Fixed and green.");
  assert.notEqual(second.cursor, first.cursor);

  const third = await dispatchRead(plugin, "transcriptSince", TEST_SESSION_ID, second.cursor);
  assert.deepEqual(third, {
    status: "accepted",
    text: "",
    cursor: second.cursor,
    truncated: false,
  });

  const unknown = await dispatchRead(
    plugin,
    "transcriptSince",
    "00000000-0000-4000-8000-000000000000",
  );
  assert.equal(unknown.status, "rejected");
});
