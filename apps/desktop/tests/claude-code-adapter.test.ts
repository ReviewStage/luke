import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import { CLAUDE_CODE_PROVIDER, ClaudeCodeSessionAdapter } from "../src/claude-code-adapter";

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const CLAUDE_PROJECTS_DIRECTORY = "projects";
const TEST_CLAUDE_EVENT_TYPE = {
  ASSISTANT: "assistant",
  RESULT: "result",
  SYSTEM: "system",
  USER: "user",
} as const;
const TEST_CLAUDE_CONTENT_TYPE = {
  TOOL_RESULT: "tool_result",
  TOOL_USE: "tool_use",
} as const;

async function temporaryClaudeHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-claude-code-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeSessionFile(
  claudeHome: string,
  projectDirectoryName: string,
  sessionFileName: string,
  records: readonly Record<string, unknown>[],
  mtimeMs: number,
): Promise<void> {
  const projectDirectory = path.join(claudeHome, CLAUDE_PROJECTS_DIRECTORY, projectDirectoryName);
  await fs.mkdir(projectDirectory, { recursive: true });
  const filePath = path.join(projectDirectory, `${sessionFileName}.jsonl`);
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

test("observes a Claude Code session file and labels it by its workspace", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "session-waiting",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        message: { content: SECRET_TRANSCRIPT_TEXT },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: { content: SECRET_TRANSCRIPT_TEXT },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, CLAUDE_CODE_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-waiting");
  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.controls, undefined);
  assert.equal(observations[0]?.detail?.repository, "luke");
});

test("keeps stale user-tail sessions unknown instead of inventing activity", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-other",
    "stale-user-tail",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/other",
        timestamp: "2026-08-11T23:25:00.000Z",
      },
    ],
    TEST_TIME - 20 * 60 * 1000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60 * 60 * 1000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("keeps stale assistant-tail sessions from staying in attention", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-review",
    "stale-assistant-tail",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/review",
        timestamp: "2026-08-11T23:25:00.000Z",
      },
    ],
    TEST_TIME - 20 * 60 * 1000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60 * 60 * 1000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("ignores trailing system records when finding Claude session status", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-system",
    "system-tail",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/system",
        timestamp: "2026-08-11T23:44:55.000Z",
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        cwd: "/Users/test/system",
        timestamp: "2026-08-11T23:44:58.000Z",
        turn_duration_ms: 3000,
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

test("treats fresh assistant tool use as active work", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-tool",
    "tool-use",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/tool",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: {
          content: [
            {
              type: TEST_CLAUDE_CONTENT_TYPE.TOOL_USE,
              name: "Read",
            },
          ],
        },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("keeps fresh sessions active when a large tail has no complete status event", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-large-tail",
    "large-tail",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/large-tail",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: {
          content: [
            {
              type: TEST_CLAUDE_CONTENT_TYPE.TOOL_USE,
              name: "Read",
            },
          ],
        },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/large-tail",
        timestamp: "2026-08-11T23:44:58.000Z",
        toolUseResult: {
          type: TEST_CLAUDE_CONTENT_TYPE.TOOL_RESULT,
          content: "x".repeat(512),
        },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
    readTailBytes: 128,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("filters old sessions and preserves the newest duplicate provider id", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-old",
    "old-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT, cwd: "/Users/test/old" }],
    TEST_TIME - 90_000,
  );
  await writeSessionFile(
    claudeHome,
    "-Users-test-duplicate-old",
    "duplicate-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT, cwd: "/Users/test/duplicate-old" }],
    TEST_TIME - 30_000,
  );
  await writeSessionFile(
    claudeHome,
    "-Users-test-duplicate-new",
    "duplicate-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.RESULT, cwd: "/Users/test/duplicate-new" }],
    TEST_TIME - 10_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => ({
      providerSessionId: observation.providerSessionId,
      status: observation.status,
      title: observation.title,
    })),
    [
      {
        providerSessionId: "duplicate-session",
        status: SESSION_STATUS.COMPLETE,
        title: "duplicate-new",
      },
    ],
  );
});

test("surfaces the generated title, branch, model, and the tool being run", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-rich",
    "rich-session",
    [
      { type: "ai-title", aiTitle: "Revamp the notch panel", sessionId: "rich-session" },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        gitBranch: "dean/notch-panel",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: {
          model: "claude-opus-5",
          stop_reason: "tool_use",
          content: [
            {
              type: TEST_CLAUDE_CONTENT_TYPE.TOOL_USE,
              name: "Bash",
              input: { description: "Package the macOS app" },
            },
          ],
        },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "Revamp the notch panel");
  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.deepEqual(observation?.detail, {
    activity: "Bash: Package the macOS app",
    repository: "luke",
    branch: "dean/notch-panel",
    model: "claude-opus-5",
  });
});

test("reports a failed request as an error a developer has to rescue", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-error",
    "errored-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        message: { stop_reason: "tool_use", content: [] },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "api_error",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        error: { formatted: "429 rate limit exceeded", status: 429 },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "429 rate limit exceeded");
});

test("clears a recorded error once the session gets past it", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-recovered",
    "recovered-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "api_error",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        error: { formatted: "529 overloaded" },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: { stop_reason: "tool_use", content: [] },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.error, undefined);
});

test("recovers a title from a session too long to hold one in its tail", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-long",
    "long-session",
    [
      { type: "ai-title", aiTitle: "Graduate the L-face identity", sessionId: "long-session" },
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        toolUseResult: { content: "x".repeat(4_096) },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: { stop_reason: "end_turn", content: [] },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
    // Small enough that the title is far behind the tail the status comes from.
    readTailBytes: 256,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "Graduate the L-face identity");
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("carries the away recap Claude Code writes for a developer who stepped out", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-away",
    "away-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: { stop_reason: "end_turn", content: [{ type: "text", text: "Closing words." }] },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "away_summary",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:58.000Z",
        content: "You asked for the notch geometry; next, say whether to ship it.",
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(
    observation?.summary,
    "You asked for the notch geometry; next, say whether to ship it.",
  );
});

test("returns an empty snapshot when Claude Code has no local project directory", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });

  assert.deepEqual(await adapter.observe(), []);
});
