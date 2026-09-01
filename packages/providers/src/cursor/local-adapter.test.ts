import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import {
  maximumSessionRecapLength,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
} from "@sidecar/session";
import type { MutableWireRecord, ParsedJsonObject } from "@sidecar/wire/testing";
import { CURSOR_PROVIDER } from "./adapter.js";
import { CursorLocalSessionAdapter } from "./local-adapter.js";

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
  TEXT: "text",
  TOOL_USE: "tool_use",
} as const;

interface CursorState {
  cursorHome: string;
  workspaceStorageDirectory: string;
  globalStorageStatePath: string;
}

function messageRecord(role: string, contentType: string): ParsedJsonObject {
  return {
    role,
    message: { content: [{ type: contentType, text: SECRET_TRANSCRIPT_TEXT }] },
  };
}

function turnEndedRecord(status: string): ParsedJsonObject {
  const record: MutableWireRecord = {
    type: TEST_RECORD_TYPE.TURN_ENDED,
    status,
  };
  if (status === TEST_TURN_STATUS.ERROR) {
    record.error = { message: SECRET_TRANSCRIPT_TEXT };
  }
  return record;
}

async function temporaryCursorState(t: TestContext): Promise<CursorState> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-cursor-local-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    cursorHome: path.join(directory, "cursor-home"),
    workspaceStorageDirectory: path.join(directory, "workspace-storage"),
    globalStorageStatePath: path.join(directory, "global-storage-state.vscdb"),
  };
}

/**
 * The app's own index of the chats its windows hold. The values are the
 * conversations themselves, which observation must never read, so the fixture
 * plants transcript text there and the tests assert it never surfaces.
 */
async function registerAppChats(state: CursorState, sessionIds: readonly string[]): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(state.globalStorageStatePath, {});
  try {
    database.exec("CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
    for (const sessionId of sessionIds) {
      database
        .prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)")
        .run(`composerData:${sessionId}`, JSON.stringify({ conversation: SECRET_TRANSCRIPT_TEXT }));
    }
  } finally {
    database.close();
  }
}

/**
 * The app's per-chat header rows, where Cursor records that a chat was filed
 * away. A header's value column carries the chat's name, which Cursor writes
 * from the opening prompt, so the fixture plants transcript text there and
 * the tests assert it never surfaces.
 */
async function writeChatHeaders(
  state: CursorState,
  chats: readonly { sessionId: string; archived: boolean; value?: ParsedJsonObject }[],
): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(state.globalStorageStatePath, {});
  try {
    database.exec(
      "CREATE TABLE IF NOT EXISTS composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, value TEXT)",
    );
    for (const chat of chats) {
      database
        .prepare(
          "INSERT OR REPLACE INTO composerHeaders (composerId, isArchived, value) VALUES (?, ?, ?)",
        )
        .run(
          chat.sessionId,
          chat.archived ? 1 : 0,
          // The subtitle is a header field this build deliberately does not
          // read, so the tests can assert it never surfaces.
          JSON.stringify({ subtitle: SECRET_TRANSCRIPT_TEXT, ...(chat.value ?? {}) }),
        );
    }
  } finally {
    database.close();
  }
}

async function writeTranscript(
  state: CursorState,
  projectDirectoryName: string,
  sessionId: string,
  records: readonly ParsedJsonObject[],
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

/** The project directory name Cursor files a folder's sessions under. */
function canonicalName(folderPath: string): string {
  return folderPath.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function projectDirectory(state: CursorState, projectDirectoryName: string): string {
  return path.join(state.cursorHome, CURSOR_PROJECTS_DIRECTORY, projectDirectoryName);
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
    activeSessionFreshnessMs?: number;
    maximumProjectDirectories?: number;
    readTailBytes?: number;
  } = {},
): CursorLocalSessionAdapter {
  return new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    ...overrides,
  });
}

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("observes an open turn as work, labelled by its folder and free of transcript text", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await registerAppChats(state, ["0b1f4b0e-2c5a-4d1e-9a3c-6d5f7e8a9b0c"]);
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
  // The address is the same /agent route Cursor's own deep-link handler
  // resolves, composed from the observed chat id alone — offered because the
  // app's own index holds this chat, which is also what seats the Cursor app
  // mark beside the agent identity, the way ChatGPT rides a Codex chat.
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    link: "cursor://anysphere.cursor-deeplink/agent?id=0b1f4b0e-2c5a-4d1e-9a3c-6d5f7e8a9b0c",
  });
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CURSOR,
      displayName: "Cursor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "cursor://anysphere.cursor-deeplink/agent?id=0b1f4b0e-2c5a-4d1e-9a3c-6d5f7e8a9b0c",
    },
  ]);
  // Nothing says this session runs anywhere but here, which is what leaves it
  // local once the registry normalizes it.
  assert.equal(observations[0]?.location, undefined);
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("tells a turn that finished from one that failed", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await registerAppChats(state, ["session-finished", "session-failed"]);
  const partingWords = "All checks are green and the branch is pushed.";
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-finished",
    [
      { role: TEST_ROLE.ASSISTANT, message: { content: [{ type: "text", text: partingWords }] } },
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 5_000,
  );
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-failed",
    [
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
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
  // A cleanly settled turn's parting words are the recap, the one bounded
  // read of the conversation's words an observation makes.
  assert.equal(observations[0]?.recap, partingWords);
  // A failed turn keeps none: the agent's parting words predate what went
  // wrong. The failure is reported; the reason Cursor recorded for it is not.
  assert.equal(observations[1]?.recap, undefined);
  assert.deepEqual(observations[1]?.detail, {
    repository: "luke",
    link: "cursor://anysphere.cursor-deeplink/agent?id=session-failed",
    error: "The turn failed",
  });
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("a recap stands only while its turn is the newest word", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  const settledTurn = [
    { role: TEST_ROLE.ASSISTANT, message: { content: [{ type: "text", text: "Done." }] } },
    turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
  ];
  // A new prompt opens a turn the old parting words no longer sum up.
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-reprompted",
    [...settledTurn, messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 5_000,
  );
  // Parting words longer than a recap may carry are cut, not refused.
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-longhand",
    [
      {
        role: TEST_ROLE.ASSISTANT,
        message: { content: [{ type: "text", text: "y".repeat(maximumSessionRecapLength + 200) }] },
      },
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 10_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations[0]?.recap, undefined);
  assert.equal(observations[1]?.recap?.length, maximumSessionRecapLength);
  assert.ok(observations[1]?.recap?.endsWith("…"));
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("names the tool call an open turn is running", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-working",
    [
      messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT),
      {
        role: TEST_ROLE.ASSISTANT,
        message: {
          content: [
            { type: TEST_CONTENT_TYPE.TEXT, text: SECRET_TRANSCRIPT_TEXT },
            { type: TEST_CONTENT_TYPE.TOOL_USE, name: "Grep", input: { pattern: "statusFrom" } },
            { type: TEST_CONTENT_TYPE.TOOL_USE, name: "Read", input: { file_path: "a/b.ts" } },
          ],
        },
      },
    ],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  // The newest call is what the turn is doing right now, named by the input
  // that says what it is for; the message text beside it never surfaces.
  assert.equal(observations[0]?.detail?.activity, "Read: a/b.ts");
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("a turn that ended is no longer running its last tool call", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  const toolCall = {
    role: TEST_ROLE.ASSISTANT,
    message: {
      content: [{ type: TEST_CONTENT_TYPE.TOOL_USE, name: "Shell", input: { command: "ls" } }],
    },
  };
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-settled",
    [toolCall, turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 5_000,
  );
  // A new prompt opens a turn that is not running the previous turn's call.
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-reprompted",
    [toolCall, messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 10_000,
  );
  // A block with no tool name says nothing about what the turn is doing.
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-unnamed-call",
    [messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TOOL_USE)],
    TEST_TIME - 15_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => [
      observation.providerSessionId,
      observation.detail?.activity,
    ]),
    [
      ["session-settled", undefined],
      ["session-reprompted", undefined],
      ["session-unnamed-call", undefined],
    ],
  );
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("bounds the phrase a tool call is named by", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-long-call",
    [
      {
        role: TEST_ROLE.ASSISTANT,
        message: {
          content: [
            {
              type: TEST_CONTENT_TYPE.TOOL_USE,
              name: "Shell",
              input: { command: `run ${"x".repeat(200)}` },
            },
          ],
        },
      },
    ],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  const activity = observations[0]?.detail?.activity;
  assert.ok(activity?.startsWith("Shell: run x"));
  assert.ok(activity !== undefined && activity.length <= "Shell: ".length + 80);
  assert.ok(activity?.endsWith("…"));
});

test("advertises a message only where the CLI's resume can honestly land one", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await registerAppChats(state, ["app-chat"]);
  const settled = [
    messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
    turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
  ];
  const open = [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)];
  await writeTranscript(state, "Users-test-luke", "cli-chat-settled", settled, TEST_TIME - 5_000);
  await writeTranscript(state, "Users-test-luke", "cli-chat-working", open, TEST_TIME - 6_000);
  await writeTranscript(state, "Users-test-luke", "app-chat", settled, TEST_TIME - 7_000);
  // A folder no workspace record names offers nowhere to pin the resume.
  await writeTranscript(
    state,
    "Users-test-mystery",
    "cli-chat-unplaced",
    settled,
    TEST_TIME - 8_000,
  );

  const adapter = new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    cursorAgent: {
      locate: async () => "/opt/test/cursor-agent",
      probeLogin: async () => true,
      launch: async () => "running" as const,
    },
  });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => [
      observation.providerSessionId,
      observation.canReceiveMessage,
    ]),
    [
      ["cli-chat-settled", true],
      ["cli-chat-working", undefined],
      ["app-chat", undefined],
      ["cli-chat-unplaced", undefined],
    ],
  );
});

test("archiving a chat withdraws its send target with its row", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "chat-filed-away",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 5_000,
  );
  const adapter = new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    cursorAgent: {
      locate: async () => "/opt/test/cursor-agent",
      probeLogin: async () => true,
      launch: async () => "running" as const,
    },
  });
  const [before] = await adapter.observe();
  assert.equal(before?.canReceiveMessage, true);

  // The user files the chat away in the app: it leaves the roster, and the
  // send target advertised for it must leave with the row rather than keep
  // authorizing from a cache the roster no longer stands behind.
  await registerAppChats(state, ["chat-filed-away"]);
  await writeChatHeaders(state, [{ sessionId: "chat-filed-away", archived: true }]);
  const observations = await adapter.observe();
  assert.equal(observations.length, 0);

  const result = await adapter.sendMessage({ providerSessionId: "chat-filed-away", text: "hi" });
  assert.equal(result.status, "unsupported");
});

test("a prompt the hook already knows about withdraws the advertisement", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  // The tail still shows a settled turn, but the hook heard a new prompt the
  // transcript has not written yet: a resume now would race the open turn.
  await writeTranscript(
    state,
    "Users-test-luke",
    "cli-chat-reprompted",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 60_000,
  );
  const spoolDirectory = path.join(state.cursorHome, "luke-spool");
  await fs.mkdir(spoolDirectory, { recursive: true });
  const promptEvent = path.join(spoolDirectory, "cli-chat-reprompted.json");
  await fs.writeFile(promptEvent, '{"event":"prompt"}');
  await fs.utimes(promptEvent, (TEST_TIME - 5_000) / 1000, (TEST_TIME - 5_000) / 1000);

  const adapter = new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
    cursorAgent: {
      locate: async () => "/opt/test/cursor-agent",
      probeLogin: async () => true,
      launch: async () => "running" as const,
    },
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.canReceiveMessage, undefined);
});

test("a machine without the CLI advertises no message at all", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "cli-chat-settled",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 5_000,
  );

  const adapter = new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    cursorAgent: {
      locate: async () => undefined,
      probeLogin: async () => true,
      launch: async () => "running" as const,
    },
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.canReceiveMessage, undefined);
  const result = await adapter.sendMessage({
    providerSessionId: "cli-chat-settled",
    text: "carry on",
  });
  assert.equal(result.status, "unsupported");
});

test("a send runs the documented resume with the developer's words behind the separator", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "cli-chat-settled",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 5_000,
  );
  const launches: { binaryPath: string; argv: readonly string[] }[] = [];
  const adapter = new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    cursorAgent: {
      locate: async () => "/opt/test/cursor-agent",
      probeLogin: async () => true,
      launch: async (binaryPath, argv) => {
        launches.push({ binaryPath, argv });
        return "running" as const;
      },
    },
  });
  await adapter.observe();

  const result = await adapter.sendMessage({
    providerSessionId: "cli-chat-settled",
    text: "--continue where you left off",
  });

  assert.equal(result.status, "accepted");
  assert.equal(launches[0]?.binaryPath, "/opt/test/cursor-agent");
  // The message rides behind the end-of-options separator, so words that look
  // like flags never read as flags, and the workspace pin is the folder
  // Cursor's own record names for the chat's project.
  assert.deepEqual(launches[0]?.argv, [
    "--resume",
    "cli-chat-settled",
    "--workspace",
    "/Users/test/luke",
    "--print",
    "--output-format",
    "json",
    "--",
    "--continue where you left off",
  ]);
});

test("a send refuses what the moment of the act no longer supports", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "cli-chat-settled",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 5_000,
  );
  const launches: string[] = [];
  let loggedIn = false;
  let earlyExitCode = 1;
  const adapter = new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    cursorAgent: {
      locate: async () => "/opt/test/cursor-agent",
      probeLogin: async () => loggedIn,
      launch: async (_binaryPath, argv) => {
        launches.push(argv.join(" "));
        return { exitCode: earlyExitCode };
      },
    },
  });
  await adapter.observe();

  // A chat that never advertised taking a message is refused before anything
  // runs — the roster is the outer bound.
  const unadvertised = await adapter.sendMessage({ providerSessionId: "ghost", text: "hello" });
  assert.equal(unadvertised.status, "unsupported");
  // A CLI signed out since the pass refuses before anything runs.
  const signedOut = await adapter.sendMessage({
    providerSessionId: "cli-chat-settled",
    text: "hello",
  });
  assert.equal(signedOut.status, "rejected");
  assert.equal(launches.length, 0);
  // An early refusal — a folder the CLI does not trust — is an answer.
  loggedIn = true;
  const refused = await adapter.sendMessage({
    providerSessionId: "cli-chat-settled",
    text: "hello",
  });
  assert.equal(refused.status, "rejected");
  assert.equal(launches.length, 1);
  // A launch that outlives the refusal window is a delivered message: the
  // transcript the adapter already observes is the report from here.
  earlyExitCode = 0;
  const delivered = await adapter.sendMessage({
    providerSessionId: "cli-chat-settled",
    text: "hello",
  });
  assert.equal(delivered.status, "accepted");
  // A transcript gone since the pass refuses rather than letting the CLI
  // silently start a fresh chat under the stale id.
  await fs.rm(
    path.join(
      state.cursorHome,
      CURSOR_PROJECTS_DIRECTORY,
      "Users-test-luke",
      CURSOR_TRANSCRIPTS_DIRECTORY,
      "cli-chat-settled",
    ),
    { recursive: true, force: true },
  );
  const gone = await adapter.sendMessage({
    providerSessionId: "cli-chat-settled",
    text: "hello",
  });
  assert.equal(gone.status, "rejected");
});

test("the observation hook sharpens what the transcript alone cannot say", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  const settled = [
    messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
    turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
  ];
  // A chat whose window or CLI closed looks exactly like one holding for its
  // developer; the hook's session-end token is the one thing that tells them
  // apart.
  await writeTranscript(state, "Users-test-luke", "session-closed", settled, TEST_TIME - 60_000);
  // A stale event — one the transcript has already moved past — is ignored.
  await writeTranscript(state, "Users-test-luke", "session-moved-on", settled, TEST_TIME - 5_000);
  const spoolDirectory = path.join(state.cursorHome, "luke-spool");
  await fs.mkdir(spoolDirectory, { recursive: true });
  const closedEvent = path.join(spoolDirectory, "session-closed.json");
  await fs.writeFile(closedEvent, '{"event":"session-end"}');
  await fs.utimes(closedEvent, (TEST_TIME - 30_000) / 1000, (TEST_TIME - 30_000) / 1000);
  const staleEvent = path.join(spoolDirectory, "session-moved-on.json");
  await fs.writeFile(staleEvent, '{"event":"session-end"}');
  await fs.utimes(staleEvent, (TEST_TIME - 60_000) / 1000, (TEST_TIME - 60_000) / 1000);

  const adapter = new CursorLocalSessionAdapter({
    ...state,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => [
      observation.providerSessionId,
      observation.status,
      observation.completionCause,
    ]),
    [
      ["session-moved-on", SESSION_STATUS.WAITING, undefined],
      ["session-closed", SESSION_STATUS.COMPLETE, SESSION_COMPLETION_CAUSE.SESSION_CLOSED],
    ],
  );
  // The event that stands dates the session as well.
  assert.equal(observations[1]?.observedAt, TEST_TIME - 30_000);
});

test("offers the app's address only for the chats the app itself holds", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await registerAppChats(state, ["app-chat"]);
  const records = [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)];
  await writeTranscript(state, "Users-test-luke", "app-chat", records, TEST_TIME - 5_000);
  // A chat Cursor's `agents` CLI started writes its transcript beside the
  // app's without registering in any window; its row keeps no provider
  // address, which is what lets a manager's own address stand in — or an
  // unmanaged terminal's row honestly open nowhere.
  await writeTranscript(state, "Users-test-luke", "cli-chat", records, TEST_TIME - 10_000);

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.detail?.link]),
    [
      ["app-chat", "cursor://anysphere.cursor-deeplink/agent?id=app-chat"],
      ["cli-chat", undefined],
    ],
  );
  // The app association follows the same gate: the app rides only its own.
  assert.equal(observations[0]?.applications?.[0]?.id, SESSION_APPLICATION_ID.CURSOR);
  assert.equal(observations[1]?.applications, undefined);
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("titles a chat by the name Cursor's own header keeps for it", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await registerAppChats(state, ["chat-named"]);
  await writeChatHeaders(state, [
    {
      sessionId: "chat-named",
      archived: false,
      value: {
        name: "Fix sticky scrolling",
        createdOnBranch: "dean/fix-sticky-scrolling",
        filesChangedCount: 3,
        totalLinesAdded: 40,
        totalLinesRemoved: 12,
        workspaceIdentifier: { uri: { fsPath: "/Users/test/elsewhere/stage" } },
      },
    },
  ]);
  await writeTranscript(
    state,
    "Users-test-luke",
    "chat-named",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 5_000,
  );
  // A chat with no header keeps the folder label it always had.
  await writeTranscript(
    state,
    "Users-test-luke",
    "chat-unnamed",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 6_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations[0]?.title, "Fix sticky scrolling");
  // The header's own folder outranks the reduced-name workspace match, for
  // the label and the branch alike; the branch is the header's created-on
  // record, the one branch observation reports.
  assert.equal(observations[0]?.detail?.repository, "stage");
  assert.equal(observations[0]?.detail?.branch, "dean/fix-sticky-scrolling");
  assert.deepEqual(observations[0]?.detail?.diff, {
    filesChanged: 3,
    linesAdded: 40,
    linesRemoved: 12,
  });
  assert.equal(observations[1]?.title, "luke");
  assert.equal(observations[1]?.detail?.branch, undefined);
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("the folder's own HEAD is never read for the branch, even where one stands", async (t) => {
  const state = await temporaryCursorState(t);
  const folder = path.join(path.dirname(state.cursorHome), "repo");
  await fs.mkdir(path.join(folder, ".git"), { recursive: true });
  await fs.writeFile(path.join(folder, ".git", "HEAD"), "ref: refs/heads/feature/live-branch\n");
  await writeWorkspaceRecord(state, "9f1c", folder);
  await registerAppChats(state, ["chat-checked-out"]);
  await writeChatHeaders(state, [
    {
      sessionId: "chat-checked-out",
      archived: false,
      value: { createdOnBranch: "main", workspaceIdentifier: { uri: { fsPath: folder } } },
    },
  ]);
  await writeTranscript(
    state,
    canonicalName(folder),
    "chat-checked-out",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 5_000,
  );
  // A worktree's .git is a pointer file to its own git directory.
  const worktreeFolder = path.join(path.dirname(state.cursorHome), "worktree");
  const worktreeGitDirectory = path.join(path.dirname(state.cursorHome), "git-worktrees", "wt");
  await fs.mkdir(worktreeFolder, { recursive: true });
  await fs.mkdir(worktreeGitDirectory, { recursive: true });
  await fs.writeFile(path.join(worktreeFolder, ".git"), `gitdir: ${worktreeGitDirectory}\n`);
  await fs.writeFile(path.join(worktreeGitDirectory, "HEAD"), "ref: refs/heads/wt-branch\n");
  await writeWorkspaceRecord(state, "7c2d", worktreeFolder);
  await writeTranscript(
    state,
    canonicalName(worktreeFolder),
    "chat-worktree",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 6_000,
  );

  const observations = await adapterFor(state).observe();

  // Both repositories stand right there to ask, and observation still
  // reports only the header's created-on record: reading a folder's `.git`
  // costs macOS's folder consent dialog when a repository lives under
  // Documents, Desktop, or Downloads, and a label is not worth a permission.
  assert.equal(observations[0]?.detail?.branch, "main");
  assert.equal(observations[1]?.detail?.branch, undefined);
});

test("a tool call holding for the user reads as waiting, not working", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await registerAppChats(state, ["chat-held", "chat-settled-hold"]);
  await writeChatHeaders(state, [
    { sessionId: "chat-held", archived: false, value: { hasBlockingPendingActions: true } },
    // A hold recorded on a settled turn is stale bookkeeping, not a wait.
    { sessionId: "chat-settled-hold", archived: false, value: { hasBlockingPendingActions: true } },
  ]);
  const openTurn = [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)];
  await writeTranscript(state, "Users-test-luke", "chat-held", openTurn, TEST_TIME - 5_000);
  await writeTranscript(
    state,
    "Users-test-luke",
    "chat-settled-hold",
    [...openTurn, turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 6_000,
  );

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["chat-held", SESSION_STATUS.WAITING],
      ["chat-settled-hold", SESSION_STATUS.WAITING],
    ],
  );
});

test("leaves a chat the app filed away off the roster", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await registerAppChats(state, ["chat-active", "chat-archived"]);
  await writeChatHeaders(state, [
    { sessionId: "chat-active", archived: false },
    { sessionId: "chat-archived", archived: true },
  ]);
  const records = [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)];
  await writeTranscript(state, "Users-test-luke", "chat-active", records, TEST_TIME - 5_000);
  await writeTranscript(state, "Users-test-luke", "chat-archived", records, TEST_TIME - 1_000);

  const observations = await adapterFor(state).observe();

  // Archiving is the app's own way of saying a chat is done being looked at,
  // so the filed chat draws no row while its transcript stays on disk.
  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["chat-active"],
  );
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("keeps a row the index cannot positively call archived", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  // A Cursor build too old to keep header rows: the chat index exists and the
  // header table does not, so nothing can vouch for a filing away.
  await registerAppChats(state, ["chat-headerless"]);
  await writeTranscript(
    state,
    "Users-test-luke",
    "chat-headerless",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "chat-headerless");
  // The chat index still answers, so the row keeps its address.
  assert.equal(
    observations[0]?.detail?.link,
    "cursor://anysphere.cursor-deeplink/agent?id=chat-headerless",
  );
});

test("a malformed app index never costs the rows themselves", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  // Not a database at all — the shape a torn write or a foreign file leaves.
  await fs.writeFile(state.globalStorageStatePath, "not a sqlite database");
  await writeTranscript(
    state,
    "Users-test-luke",
    "app-chat",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.detail?.link, undefined);
  assert.equal(observations[0]?.applications, undefined);
});

test("an app index this build cannot read withholds addresses rather than guessing", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(state.globalStorageStatePath, {});
  database.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  database.close();
  await writeTranscript(
    state,
    "Users-test-luke",
    "app-chat",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.detail?.link, undefined);
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

test("keeps a session from yesterday on the roster", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-yesterday",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 25 * 60 * 60 * 1000,
  );

  const [observation] = await adapterFor(state).observe();

  // Never hidden for its age — but a wait that stale has decayed to unknown,
  // so the row says nothing it can no longer vouch for.
  assert.equal(observation?.providerSessionId, "session-yesterday");
  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
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

test("re-reads a transcript once it has been written to again", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-evolving",
    [messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TOOL_USE)],
    TEST_TIME - 20_000,
  );

  const adapter = adapterFor(state);
  const [before] = await adapter.observe();
  await writeTranscript(
    state,
    "Users-test-luke",
    "session-evolving",
    [
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 5_000,
  );
  const [after] = await adapter.observe();

  // The same adapter serves both passes, so the second one must notice the
  // new mtime and re-read rather than serving the first parse back.
  assert.equal(before?.status, SESSION_STATUS.WORKING);
  assert.equal(after?.status, SESSION_STATUS.WAITING);
  assert.equal(after?.observedAt, TEST_TIME - 5_000);
});

test("reports every session one pass discovers, newest first", async (t) => {
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

  const observations = await adapterFor(state).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-newest", "session-older", "session-oldest"],
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

const CURSOR_CHATS_DIRECTORY = "chats";

/**
 * One chat in the CLI's chat store: a metadata record beside the conversation
 * store. The store's blobs are the conversation itself, which observation must
 * never read, so the fixture plants transcript text there and the tests assert
 * it never surfaces.
 */
async function writeChatStore(
  state: CursorState,
  hashDirectoryName: string,
  sessionId: string,
  meta: ParsedJsonObject,
  mtimeMs: number,
): Promise<void> {
  const chatDirectory = path.join(
    state.cursorHome,
    CURSOR_CHATS_DIRECTORY,
    hashDirectoryName,
    sessionId,
  );
  await fs.mkdir(chatDirectory, { recursive: true });
  const metaPath = path.join(chatDirectory, "meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta));
  await fs.utimes(metaPath, mtimeMs / 1000, mtimeMs / 1000);
  const storePath = path.join(chatDirectory, "store.db");
  await fs.writeFile(storePath, SECRET_TRANSCRIPT_TEXT);
  await fs.utimes(storePath, mtimeMs / 1000, mtimeMs / 1000);
}

function chatStoreMeta(overrides: ParsedJsonObject = {}): ParsedJsonObject {
  return {
    schemaVersion: 1,
    hasConversation: true,
    createdAtMs: TEST_TIME - 60_000,
    updatedAtMs: TEST_TIME - 5_000,
    cwd: "/Users/test/worktree",
    ...overrides,
  };
}

test("observes a chat only the chat store holds, named and placed by its own record", async (t) => {
  const state = await temporaryCursorState(t);
  await writeChatStore(
    state,
    "a34afeeb",
    "ses-store-only",
    chatStoreMeta({ title: "Math Question" }),
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  const observation = observations[0];
  assert.equal(observation?.providerSessionId, "ses-store-only");
  assert.equal(observation?.title, "Math Question");
  assert.equal(observation?.directory, "/Users/test/worktree");
  assert.equal(observation?.detail?.repository, "worktree");
  // The store is written while a turn runs, so a store that just moved is a
  // chat doing something; the blob graph holds the conversation and stays
  // unread, so no tool call, recap, or message advertisement can ride.
  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.recap, undefined);
  assert.equal(observation?.canReceiveMessage, undefined);
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("a chat store gone quiet is unknown, because its turn boundary is unreadable", async (t) => {
  const state = await temporaryCursorState(t);
  await writeChatStore(
    state,
    "a34afeeb",
    "ses-quiet",
    chatStoreMeta({ title: "Older work", updatedAtMs: TEST_TIME - YEAR_MS }),
    TEST_TIME - YEAR_MS,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("skips a chat record this build does not know, or one with no conversation", async (t) => {
  const state = await temporaryCursorState(t);
  await writeChatStore(
    state,
    "a34afeeb",
    "ses-future",
    chatStoreMeta({ schemaVersion: 2 }),
    TEST_TIME - 5_000,
  );
  await writeChatStore(
    state,
    "a34afeeb",
    "ses-empty",
    chatStoreMeta({ hasConversation: false }),
    TEST_TIME - 5_000,
  );

  assert.deepEqual(await adapterFor(state).observe(), []);
});

test("the chat store names and places a chat whose transcript is observed", async (t) => {
  const state = await temporaryCursorState(t);
  await writeTranscript(
    state,
    "Users-test-superset-worktrees-repo-square-geometry",
    "ses-both",
    [
      messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT),
      messageRecord(TEST_ROLE.ASSISTANT, TEST_CONTENT_TYPE.TEXT),
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 5_000,
  );
  await writeChatStore(
    state,
    "a34afeeb",
    "ses-both",
    chatStoreMeta({
      title: "Square geometry",
      cwd: "/Users/test/.superset/worktrees/repo/square-geometry",
    }),
    TEST_TIME - 4_000,
  );

  const observations = await adapterFor(state).observe();

  // One row: the transcript is the richer record and keeps the turn's own
  // verdict, while the store supplies the name and exact folder the
  // transcript never wrote down.
  assert.equal(observations.length, 1);
  const observation = observations[0];
  assert.equal(observation?.title, "Square geometry");
  assert.equal(observation?.directory, "/Users/test/.superset/worktrees/repo/square-geometry");
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("a chat resumed from another folder reads its freshest record", async (t) => {
  const state = await temporaryCursorState(t);
  await writeChatStore(
    state,
    "hash-old",
    "ses-moved",
    chatStoreMeta({ title: "Where it started", cwd: "/Users/test/first" }),
    TEST_TIME - 60_000,
  );
  await writeChatStore(
    state,
    "hash-new",
    "ses-moved",
    chatStoreMeta({ title: "Where it moved", cwd: "/Users/test/second" }),
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "Where it moved");
  assert.equal(observations[0]?.directory, "/Users/test/second");
});

test("leaves a chat-store chat the app filed away off the roster", async (t) => {
  const state = await temporaryCursorState(t);
  await writeChatStore(state, "a34afeeb", "ses-filed", chatStoreMeta(), TEST_TIME - 5_000);
  await writeChatHeaders(state, [{ sessionId: "ses-filed", archived: true }]);

  assert.deepEqual(await adapterFor(state).observe(), []);
});

test("a transcript chat reports the folder a resume would be pinned to", async (t) => {
  const state = await temporaryCursorState(t);
  await writeWorkspaceRecord(state, "9f1c", "/Users/test/luke");
  await writeTranscript(
    state,
    "Users-test-luke",
    "ses-pinned",
    [turnEndedRecord(TEST_TURN_STATUS.SUCCESS)],
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations[0]?.directory, "/Users/test/luke");
});

test("the store's clock keeps an open turn working while only the store moves", async (t) => {
  const state = await temporaryCursorState(t);
  // The transcript went quiet long ago and the metadata record's own
  // timestamp with it — but the store's files just moved, which is what an
  // open turn looks like from the store's side.
  await writeTranscript(
    state,
    "Users-test-luke",
    "ses-open",
    [messageRecord(TEST_ROLE.USER, TEST_CONTENT_TYPE.TEXT)],
    TEST_TIME - YEAR_MS,
  );
  await writeChatStore(
    state,
    "a34afeeb",
    "ses-open",
    chatStoreMeta({ updatedAtMs: TEST_TIME - YEAR_MS }),
    TEST_TIME - 5_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});
