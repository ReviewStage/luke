import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import {
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
  chats: readonly { sessionId: string; archived: boolean }[],
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
          JSON.stringify({ name: SECRET_TRANSCRIPT_TEXT }),
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
        message: { content: [{ type: "text", text: "y".repeat(700) }] },
      },
      turnEndedRecord(TEST_TURN_STATUS.SUCCESS),
    ],
    TEST_TIME - 10_000,
  );

  const observations = await adapterFor(state).observe();

  assert.equal(observations[0]?.recap, undefined);
  assert.equal(observations[1]?.recap?.length, 500);
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
