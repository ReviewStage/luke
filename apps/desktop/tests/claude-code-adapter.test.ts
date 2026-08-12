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

test("observes Claude Code session files without exposing transcript text", async (t) => {
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
  assert.equal(observations[0]?.title, "Claude Code: luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.controls, undefined);
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
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
        title: "Claude Code: duplicate-new",
      },
    ],
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
