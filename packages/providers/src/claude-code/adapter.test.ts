import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { isRosterRelevant, SESSION_COMPLETION_CAUSE, SESSION_STATUS } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { CLAUDE_CODE_PROVIDER, ClaudeCodeSessionAdapter } from "./adapter.js";

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
  records: readonly ParsedJsonObject[],
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
  });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, CLAUDE_CODE_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-waiting");
  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.holdingForDeveloper, undefined);
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
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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
    readTailBytes: 128,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("re-reads a transcript once it has been written to again", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "evolving-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT, cwd: "/Users/test/luke" }],
    TEST_TIME - 20_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({ claudeHome, now: () => TEST_TIME });
  const [before] = await adapter.observe();
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "evolving-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.RESULT, cwd: "/Users/test/luke" }],
    TEST_TIME - 5_000,
  );
  const [after] = await adapter.observe();

  // The same adapter serves both passes, so the second one must notice the
  // new mtime and re-read rather than serving the first parse back.
  assert.equal(before?.status, SESSION_STATUS.WAITING);
  assert.equal(after?.status, SESSION_STATUS.COMPLETE);
  assert.equal(after?.completionCause, SESSION_COMPLETION_CAUSE.WORK_FINISHED);
  assert.equal(after?.lastActivityAt, TEST_TIME - 5_000);
});

test("serves an untouched transcript from its previous parse", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "settled-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.RESULT, cwd: "/Users/test/luke" }],
    TEST_TIME - 20_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({ claudeHome, now: () => TEST_TIME });
  const [before] = await adapter.observe();
  // Same mtime, different content: only a write Claude Code actually made —
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // which moves the mtime — may cost a read, so the parse is served as it was.
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "settled-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT, cwd: "/Users/test/luke" }],
    TEST_TIME - 20_000,
  );
  const [after] = await adapter.observe();

  assert.equal(before?.status, SESSION_STATUS.COMPLETE);
  assert.equal(after?.status, SESSION_STATUS.COMPLETE);
});

test("keeps old sessions and preserves the newest duplicate provider id", async (t) => {
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
      {
        providerSessionId: "old-session",
        status: SESSION_STATUS.WAITING,
        title: "old",
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

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a failed request as an error once the retries are spent", async (t) => {
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
        retryInMs: 1056.6,
        retryAttempt: 10,
        maxRetries: 10,
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "429 rate limit exceeded");
});

test("stays working through a retry the session is still backing off from", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-retrying",
    "retrying-session",
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
        error: { formatted: "529 Overloaded", status: 529 },
        retryInMs: 575.1,
        retryAttempt: 1,
        maxRetries: 10,
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // Claude Code records every backoff, not only the attempt that gives up.
  // Interrupting on the first would be an interruption about nothing.
  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.error, undefined);
});

test("keeps a spent failure at error after it goes stale", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-stale-error",
    "stale-errored-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "api_error",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:25:00.000Z",
        error: { formatted: "429 rate limit exceeded", status: 429 },
        retryAttempt: 10,
        maxRetries: 10,
      },
    ],
    TEST_TIME - 20 * 60 * 1000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // The row would otherwise show the failure text under an "Idle" chip, and
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // stop sorting as a session that needs someone.
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
    // Small enough that the title is far behind the tail the status comes from.
    readTailBytes: 256,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "Graduate the L-face identity");
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("a settled turn's words and Claude Code's own away summary stay off the observation", async (t) => {
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
  });
  const [observation] = await adapter.observe();

  // Neither is a field about the session: the closing message is the
  // transcript itself, and the away summary is prose Claude Code wrote for
  // its own developer. An observation reports fields, never prose.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.doesNotMatch(JSON.stringify(observation), /Closing words|notch geometry/);
});

test("stops reporting a tool once the turn that ran it has ended", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-ended",
    "ended-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        message: {
          stop_reason: "tool_use",
          content: [
            {
              type: TEST_CLAUDE_CONTENT_TYPE.TOOL_USE,
              name: "Bash",
              input: { description: "Run the macOS packaging check" },
            },
          ],
        },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:52.000Z",
        message: { content: [{ type: TEST_CLAUDE_CONTENT_TYPE.TOOL_RESULT }] },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Packaging passed." }],
        },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // A tool left behind here would make the settled session read as though it
  // were still working on it.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.detail?.activity, undefined);
});

test("keeps reporting a tool between one call and the next", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-between",
    "between-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        message: {
          stop_reason: "tool_use",
          content: [
            {
              type: TEST_CLAUDE_CONTENT_TYPE.TOOL_USE,
              name: "Bash",
              input: { description: "Run the macOS packaging check" },
            },
          ],
        },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:52.000Z",
        message: { content: [{ type: TEST_CLAUDE_CONTENT_TYPE.TOOL_RESULT }] },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, "Bash: Run the macOS packaging check");
});

test("returns an empty snapshot when Claude Code has no local project directory", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });

  assert.deepEqual(await adapter.observe(), []);
});

test("dates a touched transcript by its own records rather than the touch", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const lastRecordTime = "2026-08-11T20:45:00.000Z";
  await writeSessionFile(
    claudeHome,
    "-Users-test-touched",
    "touched-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/touched",
        timestamp: "2026-08-11T20:44:50.000Z",
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/touched",
        timestamp: lastRecordTime,
        message: { stop_reason: "end_turn", content: [] },
      },
      // The bookkeeping record a later pass appended: no timestamp, and the
      // same pass is what bumped the file's mtime to the present.
      { type: "last-prompt", cwd: "/Users/test/touched" },
    ],
    TEST_TIME,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // Three hours old by its own clock, so the row must say so — and a session
  // that old has left the freshness window however recently it was touched.
  assert.equal(observation?.lastActivityAt, Date.parse(lastRecordTime));
  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
});

test("keeps a touch from making a long-settled session look recent", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-ancient",
    "ancient-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/ancient",
        timestamp: "2026-06-25T08:30:00.000Z",
        message: { stop_reason: "end_turn", content: [] },
      },
    ],
    TEST_TIME,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // A session is never hidden for being old, but the touch must not stand in
  // for work: the row reports the transcript's own clock, weeks back, and a
  // wait that stale has long since decayed to unknown.
  assert.equal(observation?.lastActivityAt, Date.parse("2026-06-25T08:30:00.000Z"));
  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
});

test("falls back to the file's date when the tail carries no timestamp", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-untimed",
    "untimed-session",
    [{ type: TEST_CLAUDE_EVENT_TYPE.USER, cwd: "/Users/test/untimed" }],
    TEST_TIME - 5_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.lastActivityAt, TEST_TIME - 5_000);
});

test("reads past a tail of appended bookkeeping to the conversation's own clock", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const lastConversationTime = "2026-02-14T10:05:00.000Z";
  await writeSessionFile(
    claudeHome,
    "-Users-test-backfilled",
    "backfilled-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/backfilled",
        timestamp: "2026-02-14T10:00:00.000Z",
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/backfilled",
        timestamp: lastConversationTime,
        message: { stop_reason: "end_turn", content: [] },
      },
      // The bookkeeping a later Claude Code pass appended in bulk: enough of
      // it to fill the whole bounded tail, with the same pass bumping mtime.
      { type: "ai-title", aiTitle: "Old refactor" },
      { type: "last-prompt", cwd: "/Users/test/backfilled", prompt: "x".repeat(120) },
    ],
    TEST_TIME,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    readTailBytes: 256,
  });
  const [observation] = await adapter.observe();

  // A tail holding only bookkeeping says nothing about when the conversation
  // last moved, and the touch must not answer for it: the second, deeper read
  // finds the conversation's own clock months back, so the session reads as
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // settled history rather than as work happening right now.
  assert.equal(observation?.lastActivityAt, Date.parse(lastConversationTime));
  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observation?.title, "Old refactor");
  assert.equal(
    observation &&
      isRosterRelevant(
        { status: observation.status, lastActivityAt: observation.lastActivityAt },
        TEST_TIME,
      ),
    false,
  );
});

test("keeps a bookkeeping record's timestamp from re-dating the conversation", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const lastConversationTime = "2026-02-14T10:05:00.000Z";
  await writeSessionFile(
    claudeHome,
    "-Users-test-redated",
    "redated-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/redated",
        timestamp: "2026-02-14T10:00:00.000Z",
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/redated",
        timestamp: lastConversationTime,
        message: { stop_reason: "end_turn", content: [] },
      },
      // Bookkeeping stamped with the moment it was appended rather than the
      // moment the conversation moved.
      { type: "queue-operation", operation: "enqueue", timestamp: "2026-08-11T23:44:59.000Z" },
    ],
    TEST_TIME,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // Only the conversation's own records may date the session: a settled turn
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // from months ago must not read as waiting for the developer today just
  // because the provider stamped a bookkeeping line beside it.
  assert.equal(observation?.lastActivityAt, Date.parse(lastConversationTime));
  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(
    observation &&
      isRosterRelevant(
        { status: observation.status, lastActivityAt: observation.lastActivityAt },
        TEST_TIME,
      ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Hook-event refinement. Every test here layers a spool the observation hook
// would have written over a transcript, because that is the arrangement in
// production: the tail is always read, and the event only sharpens it.
// ---------------------------------------------------------------------------

async function temporaryHookSpool(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-claude-spool-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeHookEvent(
  spoolDirectory: string,
  providerSessionId: string,
  event: string,
  mtimeMs: number,
): Promise<void> {
  const filePath = path.join(spoolDirectory, `${providerSessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify({ event }));
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

/** A transcript mid-turn: the assistant reached for a tool and has not returned. */
function midTurnRecords(cwd: string, timestamp: string): ParsedJsonObject[] {
  return [
    {
      type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
      cwd,
      timestamp,
      message: {
        stop_reason: "tool_use",
        content: [{ type: TEST_CLAUDE_CONTENT_TYPE.TOOL_USE, name: "Bash" }],
      },
    },
  ];
}

test("a permission prompt the transcript cannot show turns the row to waiting", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  // Mid-turn by every record: a tool call holding for permission writes
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // nothing further, so without the event this session reads as working.
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "held-for-permission",
    midTurnRecords("/Users/test/luke", "2026-08-11T23:40:00.000Z"),
    TEST_TIME - 5 * 60 * 1000,
  );
  await writeHookEvent(spool, "held-for-permission", "notification", TEST_TIME - 60_000);

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
  // The event also dates the session: the spool is written only by Luke's own
  // script, so its clock cannot suffer the transcripts' bulk-touch problem.
  assert.equal(observation?.lastActivityAt, TEST_TIME - 60_000);
});

test("a session-end event settles a row the tail would leave waiting", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "closed-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:40:00.000Z",
        message: { stop_reason: "end_turn", content: [] },
      },
    ],
    TEST_TIME - 5 * 60 * 1000,
  );
  await writeHookEvent(spool, "closed-session", "session-end", TEST_TIME - 60_000);

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.COMPLETE);
  assert.equal(observation?.completionCause, SESSION_COMPLETION_CAUSE.SESSION_CLOSED);
});

test("a stop-failure event reports the error the tail was still suppressing", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "gave-up",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "api_error",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:40:00.000Z",
        // Mid-backoff bookkeeping, which on its own is rightly suppressed.
        retryAttempt: 1,
        maxRetries: 10,
        error: { message: "rate limited" },
      },
    ],
    TEST_TIME - 5 * 60 * 1000,
  );
  await writeHookEvent(spool, "gave-up", "stop-failure", TEST_TIME - 60_000);

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
});

test("a stop event keeps a finished turn waiting past the freshness decay", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  // Twenty minutes past the last record, the tail alone decays to unknown.
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "still-waiting",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:25:00.000Z",
        message: { stop_reason: "end_turn", content: [] },
      },
    ],
    TEST_TIME - 20 * 60 * 1000,
  );
  await writeHookEvent(spool, "still-waiting", "stop", TEST_TIME - 60_000);

  const adapter = new ClaudeCodeSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("an event the transcript has moved past refines nothing", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "moved-on",
    midTurnRecords("/Users/test/luke", "2026-08-11T23:44:00.000Z"),
    TEST_TIME - 60_000,
  );
  // A stop from a minute before the transcript's last record: hooks were off,
  // or the write raced. The session is demonstrably mid-turn again.
  await writeHookEvent(spool, "moved-on", "stop", TEST_TIME - 2 * 60 * 1000);

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.lastActivityAt, Date.parse("2026-08-11T23:44:00.000Z"));
});

test("a stop event does not unsay a result the transcript recorded", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "print-run",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.RESULT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:00.000Z",
      },
    ],
    TEST_TIME - 60_000,
  );
  // Stop fires beside the result record; the settled outcome outranks it.
  await writeHookEvent(spool, "print-run", "stop", TEST_TIME - 59_000);

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.COMPLETE);
});

test("a session-start event bumps the clock without deciding the status", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "resumed",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:25:00.000Z",
        message: { stop_reason: "end_turn", content: [] },
      },
    ],
    TEST_TIME - 20 * 60 * 1000,
  );
  await writeHookEvent(spool, "resumed", "session-start", TEST_TIME - 60_000);

  const adapter = new ClaudeCodeSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // Freshened by the resume, the tail's own verdict — a turn that ended is
  // holding for the developer — stands again.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.lastActivityAt, TEST_TIME - 60_000);
});

test("a spool that cannot be read costs only the refinement", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "unrefined",
    midTurnRecords("/Users/test/luke", "2026-08-11T23:44:00.000Z"),
    TEST_TIME - 60_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    hookEventsDirectory: () => path.join(claudeHome, "no-such-spool"),
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a notification the transcript has answered stands down at once", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const spool = await temporaryHookSpool(t);
  // The permission was granted and the tool ran: a record newer than the
  // notification, though within the tolerance the other events enjoy.
  await writeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "granted",
    midTurnRecords("/Users/test/luke", "2026-08-11T23:44:59.000Z"),
    TEST_TIME - 1_000,
  );
  await writeHookEvent(spool, "granted", "notification", TEST_TIME - 3_000);

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a chosen title outranks the generated one, wherever the tail read finds it", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-named",
    "named-session",
    [
      { type: "ai-title", aiTitle: "Investigate flaky tests", sessionId: "named-session" },
      { type: "custom-title", customTitle: "Claude Code app chat detection" },
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        message: { content: SECRET_TRANSCRIPT_TEXT },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({ claudeHome, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "Claude Code app chat detection");
});

test("recovers a chosen title from the head of a session too long to hold one in its tail", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const filler = Array.from({ length: 40 }, (_, index) => ({
    type: TEST_CLAUDE_EVENT_TYPE.USER,
    cwd: "/Users/test/luke",
    timestamp: `2026-08-11T23:44:${String(10 + index).padStart(2, "0")}.000Z`,
    message: { content: SECRET_TRANSCRIPT_TEXT.repeat(4) },
  }));
  await writeSessionFile(
    claudeHome,
    "-Users-test-renamed",
    "renamed-session",
    [{ type: "custom-title", customTitle: "Renamed early" }, ...filler],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    readTailBytes: 512,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "Renamed early");
});

test("a chosen title in the head outranks a generated one the tail still holds", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  const filler = Array.from({ length: 40 }, (_, index) => ({
    type: TEST_CLAUDE_EVENT_TYPE.USER,
    cwd: "/Users/test/luke",
    timestamp: `2026-08-11T23:44:${String(10 + index).padStart(2, "0")}.000Z`,
    message: { content: SECRET_TRANSCRIPT_TEXT.repeat(4) },
  }));
  await writeSessionFile(
    claudeHome,
    "-Users-test-retitled",
    "retitled-session",
    [
      { type: "custom-title", customTitle: "Chosen early" },
      ...filler,
      { type: "ai-title", aiTitle: "Generated late", sessionId: "retitled-session" },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new ClaudeCodeSessionAdapter({
    claudeHome,
    now: () => TEST_TIME,
    readTailBytes: 512,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "Chosen early");
});
