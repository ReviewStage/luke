import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { SESSION_STATUS } from "@sidecar/core";
import { CURSOR_PROVIDER } from "../src/cursor-adapter";
import { CursorLocalSessionAdapter } from "../src/cursor-local-adapter";

const TEST_TIME = Date.parse("2026-08-13T02:45:00.000Z");
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const CURSOR_PROJECTS_DIRECTORY = "projects";
const CURSOR_TRANSCRIPTS_DIRECTORY = "agent-transcripts";
const CURSOR_WORKSPACE_FILE = "workspace.json";

const TEST_ROLE = {
  ASSISTANT: "assistant",
  USER: "user",
} as const;

const TEST_RECORD_TYPE = {
  TURN_ENDED: "turn_ended",
} as const;

const TEST_TURN_STATUS = {
  ERROR: "error",
  SUCCESS: "success",
} as const;

const TEST_CONTENT_TYPE = {
  CUSTOM: "custom_block",
  TEXT: "text",
  THINKING: "thinking",
  TOOL_CALL: "tool_call",
  TOOL_CALL_HYPHENATED: "tool-call",
  TOOL_USE: "tool_use",
  TOOL_USE_HYPHENATED: "tool-use",
} as const;

interface CursorState {
  cursorHome: string;
  workspaceStorageDirectory: string;
}

function messageRecord(role: string, contentType: string): Record<string, unknown> {
  return {
    role,
    message: { content: [{ type: contentType, text: SECRET_TRANSCRIPT_TEXT }] },
  };
}

function turnEndedRecord(status: string): Record<string, unknown> {
  return {
    type: TEST_RECORD_TYPE.TURN_ENDED,
    status,
    ...(status === TEST_TURN_STATUS.ERROR ? { error: { message: SECRET_TRANSCRIPT_TEXT } } : {}),
  };
}

async function temporaryCursorState(t: TestContext): Promise<CursorState> {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "luke-cursor-local-")),
  );
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    cursorHome: path.join(directory, "cursor-home"),
    workspaceStorageDirectory: path.join(directory, "workspace-storage"),
  };
}

async function writeTranscript(
  state: CursorState,
  projectDirectoryName: string,
  sessionId: string,
  records: readonly Record<string, unknown>[],
  mtimeMs: number,
): Promise<void> {
  const sessionDirectory = path.join(
    state.cursorHome,
    CURSOR_PROJECTS_DIRECTORY,
    projectDirectoryName,
    CURSOR_TRANSCRIPTS_DIRECTORY,
    sessionId,
  );
  await fs.mkdir(sessionDirectory, { recursive: true });
  const filePath = path.join(sessionDirectory, `${sessionId}.jsonl`);
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

/** A session's subagents file their transcripts beside its own. */
async function writeSubagentTranscript(
  state: CursorState,
  projectDirectoryName: string,
  sessionId: string,
  subagentId: string,
  mtimeMs: number,
): Promise<void> {
  const subagentsDirectory = path.join(
    state.cursorHome,
    CURSOR_PROJECTS_DIRECTORY,
    projectDirectoryName,
    CURSOR_TRANSCRIPTS_DIRECTORY,
    sessionId,
    "subagents",
  );
  await fs.mkdir(subagentsDirectory, { recursive: true });
  const filePath = path.join(subagentsDirectory, `${subagentId}.jsonl`);
  await fs.writeFile(
    filePath,
    `${JSON.stringify(messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT))}\n`,
  );
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

function projectDirectory(state: CursorState, projectDirectoryName: string): string {
  return path.join(state.cursorHome, CURSOR_PROJECTS_DIRECTORY, projectDirectoryName);
}

function cursorProjectName(folderPath: string): string {
  return folderPath.split(path.sep).filter(Boolean).join("-");
}

/**
 * Backdates a directory the way the filesystem would have. A directory's mtime
 * moves when it gains or loses an entry and at no other time, so a project's
 * and its transcripts directory's can be years apart.
 */
async function setDirectoryMtime(directory: string, mtimeMs: number): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.utimes(directory, mtimeMs / 1000, mtimeMs / 1000);
}

/** Cursor's own record of a window it opened on a folder. */
async function writeWorkspaceRecord(
  state: CursorState,
  entryName: string,
  folderPath: string | undefined,
): Promise<void> {
  const entryDirectory = path.join(state.workspaceStorageDirectory, entryName);
  await fs.mkdir(entryDirectory, { recursive: true });
  await fs.writeFile(
    path.join(entryDirectory, CURSOR_WORKSPACE_FILE),
    JSON.stringify(folderPath ? { folder: pathToFileURL(folderPath).href } : {}),
  );
}

function adapterFor(
  state: CursorState,
  overrides: {
    now?: () => number;
    maximumSessionAgeMs?: number;
    activeSessionFreshnessMs?: number;
    maximumProjectDirectories?: number;
    maximumSessionFiles?: number;
    readTailBytes?: number;
  } = {},
): CursorLocalSessionAdapter {
  return new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60 * 60 * 1000,
    ...overrides,
  });
}

test("observes an open turn as work, labelled by its folder and free of transcript text", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "0b1f4b0e-2c5a-4d1e-9a3c-6d5f7e8a9b0c",
    [
      messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT),
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TOOL_USE),
    ],
    TEST_TIME - 5_000,
  );

  const adapter = adapterFor(state);
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, CURSOR_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "0b1f4b0e-2c5a-4d1e-9a3c-6d5f7e8a9b0c");
  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 5_000);
  assert.equal(observations[0]?.controls, undefined);
  assert.equal(observations[0]?.recap, undefined);
  assert.deepEqual(observations[0]?.detail, { repository: "luke" });
  // Nothing says this session runs anywhere but here, which is what leaves it
  // local once the registry normalizes it.
  assert.equal(observations[0]?.location, undefined);
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("observes a current-format assistant reply as a settled turn", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-settled",
    [
      messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT),
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
    ],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("keeps a current-format turn open for every known tool-call spelling", async (t) => {
  const state = await temporaryCursorState(t);
  for (const [index, contentType] of [
    TEST_CONTENT_TYPE.TOOL_USE,
    TEST_CONTENT_TYPE.TOOL_USE_HYPHENATED,
    TEST_CONTENT_TYPE.TOOL_CALL,
    TEST_CONTENT_TYPE.TOOL_CALL_HYPHENATED,
  ].entries()) {
    await writeTranscript(
      state,
      "Users-test-luke",
      `session-tool-${index}`,
      [messageRecord(TEST_ROLE.ASSISTANT, contentType)],
      TEST_TIME - (index + 1) * 1_000,
    );
  }

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => observation.status),
    Array.from({ length: 4 }, () => SESSION_STATUS.WORKING),
  );
});

test("settles on assistant messages with thinking, unknown, or string content", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-thinking",
    [
      {
        role: TEST_ROLE.ASSISTANT,
        message: {
          content: [
            { type: TEST_CONTENT_TYPE.THINKING, text: SECRET_TRANSCRIPT_TEXT },
            { type: TEST_CONTENT_TYPE.TEXT, text: SECRET_TRANSCRIPT_TEXT },
          ],
        },
      },
    ],
    TEST_TIME - 1_000,
  );
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-unknown-block",
    [messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.CUSTOM)],
    TEST_TIME - 2_000,
  );
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-string-content",
    [{ role: TEST_ROLE.ASSISTANT, message: { content: SECRET_TRANSCRIPT_TEXT } }],
    TEST_TIME - 3_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => observation.status),
    Array.from({ length: 3 }, () => SESSION_STATUS.WAITING),
  );
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("tells a turn that finished from one that failed", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-finished",
    [
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 5_000,
  );
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-failed",
    [
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TOOL_USE),
      turnEndedRecord(TEST_TURN_STATUS.ERROR),
    ],
    TEST_TIME - 10_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["session-finished", SESSION_STATUS.WAITING],
      ["session-failed", SESSION_STATUS.ERROR],
    ],
  );
  // The failure is reported; the reason Cursor recorded for it is not.
  assert.deepEqual(observations[1]?.detail, {
    repository: "luke",
    error: "The turn failed",
  });
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("passes over trailing records this build does not know", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-annotated",
    [
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
      { type: "some_later_record", detail: SECRET_TRANSCRIPT_TEXT },
    ],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

test("leaves a transcript that has gone quiet unknown instead of inventing activity", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-quiet",
    [messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TOOL_USE)],
    TEST_TIME - 20 * 60 * 1000,
  );
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-abandoned",
    [
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 21 * 60 * 1000,
  );

  const observations = await adapterFor(state, {
    activeSessionFreshnessMs: 15 * 60 * 1000,
  }).observe();

  assert.deepEqual(
    observations.map((observation) => observation.status),
    [SESSION_STATUS.UNKNOWN, SESSION_STATUS.UNKNOWN],
  );
});

test("keeps reporting a failure that has gone quiet, because it has not healed", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-stuck",
    [
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TOOL_USE),
      turnEndedRecord(TEST_TURN_STATUS.ERROR),
    ],
    TEST_TIME - 40 * 60 * 1000,
  );

  const observations = await adapterFor(state, {
    activeSessionFreshnessMs: 15 * 60 * 1000,
  }).observe();

  assert.deepEqual(
    observations.map((observation) => observation.status),
    [SESSION_STATUS.ERROR],
  );
});

test("ignores sessions older than the maximum session age", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-yesterday",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 25 * 60 * 60 * 1000,
  );

  const observations = await adapterFor(state, {
    maximumSessionAgeMs: 24 * 60 * 60 * 1000,
  }).observe();

  assert.deepEqual(observations, []);
});

test("names a folder its project directory can no longer spell", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "6a20", "/Users/test/luke.github.io");
  await writeWorkspaceRecord(state, "77b8", "/Users/test/Documents/[00] Notes:Archive");
  await writeWorkspaceRecord(state, "c4d1", "/Users/test/workspaces/luke/sidecar-v2");
  await writeTranscript(
    state,
    "Users-test-luke-github-io",
    "session-site",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );
  await writeTranscript(
    state,
    "Users-test-Documents-00-Notes-Archive",
    "session-notes",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 2_000,
  );
  await writeTranscript(
    state,
    "Users-test-workspaces-luke-sidecar-v2",
    "session-workspace",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 3_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => observation.title),
    ["luke.github.io", "[00] Notes:Archive", "sidecar-v2"],
  );
});

test("names a folder whose project directory kept a character Luke would rewrite", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "4d5e", "/Users/test/my_project");
  await writeWorkspaceRecord(state, "8f9a", "/Users/test/Notes (2026)");
  // Cursor decides for itself which characters it will not put in a directory
  // name, so these keep an underscore and a bracket that Luke's own reduction
  // would have rewritten. Matching must not depend on agreeing with it.
  await writeTranscript(
    state,
    "Users-test-my_project",
    "session-underscored",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );
  await writeTranscript(
    state,
    "Users-test-Notes (2026)",
    "session-bracketed",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 2_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => observation.title),
    ["my_project", "Notes (2026)"],
  );
});

test("names an existing folder without a Cursor workspace record", async (t) => {
  const state = await temporaryCursorState(t);
  const folderPath = path.join(path.dirname(state.cursorHome), "workspaces", "luke");
  await fs.mkdir(folderPath, { recursive: true });
  await writeTranscript(
    state,
    cursorProjectName(folderPath),
    "session-filesystem-labelled",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "luke");
  assert.deepEqual(observations[0]?.detail, { repository: "luke" });
});

test("refuses a project directory name that resolves to two folders", async (t) => {
  const state = await temporaryCursorState(t);
  const root = path.join(path.dirname(state.cursorHome), "ambiguous");
  const firstFolder = path.join(root, "alpha", "beta-gamma");
  const secondFolder = path.join(root, "alpha-beta", "gamma");
  await Promise.all([
    fs.mkdir(firstFolder, { recursive: true }),
    fs.mkdir(secondFolder, { recursive: true }),
  ]);
  await writeTranscript(
    state,
    cursorProjectName(firstFolder),
    "session-ambiguous-filesystem",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "workspace");
});

test("refuses a project directory name that resolves to no folder", async (t) => {
  const state = await temporaryCursorState(t);
  const missingFolder = path.join(path.dirname(state.cursorHome), "missing", "folder");
  await writeTranscript(
    state,
    cursorProjectName(missingFolder),
    "session-missing-filesystem",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "workspace");
});

test("keeps a literal hyphen in the uniquely resolved folder label", async (t) => {
  const state = await temporaryCursorState(t);
  const folderPath = path.join(path.dirname(state.cursorHome), "workspaces", "little-rock");
  await fs.mkdir(folderPath, { recursive: true });
  await writeTranscript(
    state,
    cursorProjectName(folderPath),
    "session-hyphenated-filesystem",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "little-rock");
});

test("labels a session neutrally rather than guessing at a folder", async (t) => {
  const state = await temporaryCursorState(t);
  // A window with no folder, and two folders that share one project directory
  // name while disagreeing about what it should be called.
  await writeWorkspaceRecord(state, "1a2b", undefined);
  await writeWorkspaceRecord(state, "3c4d", "/Users/test/luke-v2");
  await writeWorkspaceRecord(state, "5e6f", "/Users/test/luke/v2");
  await writeTranscript(
    state,
    "empty-window",
    "session-windowed",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );
  await writeTranscript(
    state,
    "Users-test-luke-v2",
    "session-ambiguous",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 2_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => observation.title),
    ["workspace", "workspace"],
  );
});

test("a workspace record that is not JSON does not fail the observation pass", async (t) => {
  const state = await temporaryCursorState(t);
  const entryDirectory = path.join(state.workspaceStorageDirectory, "broken");
  await fs.mkdir(entryDirectory, { recursive: true });
  await fs.writeFile(path.join(entryDirectory, CURSOR_WORKSPACE_FILE), "{");
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-labelled",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "workspace");
});

test("observes a session and not the subagents it ran", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-with-subagents",
    [messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TOOL_USE)],
    TEST_TIME - 5_000,
  );
  await writeSubagentTranscript(
    state,
    "Users-test-luke",
    "session-with-subagents",
    "subagent-explore",
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-with-subagents"],
  );
});

test("finds the newest records when only the end of a long transcript is read", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-long",
    [
      { role: TEST_ROLE.ASSISTANT, message: { content: [{ text: "x".repeat(512) }] } },
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state, { readTailBytes: 128 }).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

test("keeps working when a bounded tail contains no whole record", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-oversized-record",
    [
      {
        role: TEST_ROLE.ASSISTANT,
        message: {
          content: [{ type: TEST_CONTENT_TYPE.TEXT, text: SECRET_TRANSCRIPT_TEXT.repeat(128) }],
        },
      },
    ],
    TEST_TIME - 1_000,
  );

  const observations = await adapterFor(state, { readTailBytes: 128 }).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("bounds how many sessions one pass reports, keeping the newest", async (t) => {
  const state = await temporaryCursorState(t);
  for (const [index, sessionId] of [
    "session-newest",
    "session-older",
    "session-oldest",
  ].entries()) {
    await writeTranscript(
      state,
      "Users-test-luke",
      sessionId,
      [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
      TEST_TIME - (index + 1) * 1_000,
    );
  }

  const observations = await adapterFor(state, { maximumSessionFiles: 2 }).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-newest", "session-older"],
  );
});

test("keeps the projects that most recently started a session", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/daily");
  await writeWorkspaceRecord(state, "7b2e", "/Users/test/dormant");
  await writeTranscript(
    state,
    "Users-test-daily",
    "session-today",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 1_000,
  );
  await writeTranscript(
    state,
    "Users-test-dormant",
    "session-long-ago",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 2_000,
  );
  // The project Cursor wrote to first holds the newer session, and a folder
  // opened moments ago has never run an agent at all. A project directory's own
  // mtime tells all three apart backwards.
  await setDirectoryMtime(projectDirectory(state, "Users-test-daily"), TEST_TIME - YEAR_MS);
  await setDirectoryMtime(projectDirectory(state, "Users-test-dormant"), TEST_TIME - 60_000);
  await setDirectoryMtime(projectDirectory(state, "Users-test-opened-today"), TEST_TIME);
  await setDirectoryMtime(
    path.join(projectDirectory(state, "Users-test-daily"), CURSOR_TRANSCRIPTS_DIRECTORY),
    TEST_TIME - 1_000,
  );
  await setDirectoryMtime(
    path.join(projectDirectory(state, "Users-test-dormant"), CURSOR_TRANSCRIPTS_DIRECTORY),
    TEST_TIME - YEAR_MS,
  );

  const observations = await adapterFor(state, { maximumProjectDirectories: 1 }).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-today"],
  );
});

test("returns an empty snapshot when Cursor has no local sessions", async (t) => {
  const state = await temporaryCursorState(t);

  assert.deepEqual(await adapterFor(state).observe(), []);
});
