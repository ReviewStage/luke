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
    maximumSessionAgeMs: 60_000,
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
    maximumSessionAgeMs: 60_000,
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
    maximumSessionAgeMs: 60 * 60 * 1000,
  });
  const [observation] = await adapter.observe();

  // The row would otherwise show the failure text under an "Idle" chip, and
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

test("drops the previous turn's recap when a new prompt opens a turn", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-recap",
    "recap-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:40.000Z",
        message: { stop_reason: "end_turn", content: [{ type: "text", text: "First turn." }] },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "away_summary",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:42.000Z",
        content: "The first turn's recap.",
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.USER,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:50.000Z",
        message: { content: [{ type: "text", text: "Now do the other thing." }] },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: { stop_reason: "end_turn", content: [{ type: "text", text: "Second turn." }] },
      },
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "away_summary",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:57.000Z",
        content: "The second turn's recap.",
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
  assert.equal(observation?.summary, "The second turn's recap.");
});

test("reports no recap for a turn whose closing words are all it wrote", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(
    claudeHome,
    "-Users-test-closing",
    "closing-session",
    [
      {
        type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:55.000Z",
        message: {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Everything in src/totals.ts now rounds per line." }],
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

  // The closing message is the transcript itself, not a recap Claude Code wrote
  // about the session, and a summary reaches the attention evaluator.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.summary, undefined);
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
      {
        type: TEST_CLAUDE_EVENT_TYPE.SYSTEM,
        subtype: "away_summary",
        cwd: "/Users/test/luke",
        timestamp: "2026-08-11T23:44:57.000Z",
        content: "Packaging passed; next, say whether to notarize.",
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

  // The row prefers activity over the recap, so a tool left behind here would
  // hide what the session actually wants to say.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.detail?.activity, undefined);
  assert.equal(observation?.summary, "Packaging passed; next, say whether to notarize.");
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
    maximumSessionAgeMs: 60_000,
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
  assert.equal(observation?.observedAt, Date.parse(lastRecordTime));
  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
});

test("keeps a touch from carrying a session past the observation window", async (t) => {
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

  assert.deepEqual(await adapter.observe(), []);
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

  assert.equal(observation?.observedAt, TEST_TIME - 5_000);
});
