import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { SESSION_STATUS, UNKNOWN_WORKSPACE_LABEL } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { GEMINI_CLI_PROVIDER, GeminiCliSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-20T12:00:00.000Z");
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const GEMINI_TMP_DIRECTORY = "tmp";
const GEMINI_CHATS_DIRECTORY = "chats";
const GEMINI_PROJECT_ROOT_FILE = ".project_root";

async function temporaryGeminiHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-gemini-cli-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeSessionFile(
  geminiHome: string,
  projectDirectoryName: string,
  sessionFileName: string,
  records: readonly ParsedJsonObject[],
  mtimeMs: number,
): Promise<void> {
  const chatsDirectory = path.join(
    geminiHome,
    GEMINI_TMP_DIRECTORY,
    projectDirectoryName,
    GEMINI_CHATS_DIRECTORY,
  );
  await fs.mkdir(chatsDirectory, { recursive: true });
  const filePath = path.join(chatsDirectory, `${sessionFileName}.jsonl`);
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

async function writeProjectRoot(
  geminiHome: string,
  projectDirectoryName: string,
  projectPath: string,
): Promise<void> {
  const projectDirectory = path.join(geminiHome, GEMINI_TMP_DIRECTORY, projectDirectoryName);
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.writeFile(path.join(projectDirectory, GEMINI_PROJECT_ROOT_FILE), `${projectPath}\n`);
}

function metadataRecord(sessionId: string, startTime: string): ParsedJsonObject {
  return { sessionId, projectHash: "a".repeat(64), startTime, lastUpdated: startTime };
}

function userMessage(id: string, timestamp: string, content: string): ParsedJsonObject {
  return { id, type: "user", timestamp, content };
}

// Neutral words, because a settled turn's parting words are deliberately
// reported as the recap; SECRET_TRANSCRIPT_TEXT marks only what must never
// surface — prompts, and the words of a turn still under way.
function geminiMessage(
  id: string,
  timestamp: string,
  extra: ParsedJsonObject = {},
): ParsedJsonObject {
  return { id, type: "gemini", timestamp, content: "Parting words.", ...extra };
}

test("observes a settled Gemini session and labels it by its project", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeProjectRoot(geminiHome, "luke", "/Users/test/luke");
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-58-abcd1234",
    [
      metadataRecord("abcd1234-full-id", "2026-08-20T11:58:00.000Z"),
      userMessage("m1", "2026-08-20T11:58:10.000Z", SECRET_TRANSCRIPT_TEXT),
      {
        id: "m2",
        type: "gemini",
        timestamp: "2026-08-20T11:59:00.000Z",
        content: "Done; the tests pass.",
        model: "gemini-3-pro-preview",
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, GEMINI_CLI_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-2026-08-20T11-58-abcd1234");
  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.observedAt, Date.parse("2026-08-20T11:59:00.000Z"));
  assert.equal(observations[0]?.detail?.repository, "luke");
  assert.equal(observations[0]?.detail?.model, "gemini-3-pro-preview");
  assert.equal(observations[0]?.controls, undefined);
  assert.equal(observations[0]?.recap, "Done; the tests pass.");
});

test("keeps a recap only for a turn that settled cleanly", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-00c0ffee",
    [
      geminiMessage("m1", "2026-08-20T11:57:00.000Z", {
        toolCalls: [
          {
            id: "t1",
            name: "grep",
            args: {},
            status: "executing",
            timestamp: "2026-08-20T11:57:01.000Z",
          },
        ],
      }),
    ],
    TEST_TIME - 1_000,
  );
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-00faded0",
    [
      geminiMessage("m1", "2026-08-20T11:58:00.000Z"),
      userMessage("m2", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();
  const byId = new Map(
    observations.map((observation) => [observation.providerSessionId, observation]),
  );

  // A turn still working has no parting words, and a newer prompt means the
  // previous turn's words no longer describe the session.
  assert.equal(byId.get("session-2026-08-20T11-59-00c0ffee")?.recap, undefined);
  assert.equal(byId.get("session-2026-08-20T11-59-00faded0")?.recap, undefined);
});

test("titles a session by the summary the CLI wrote about it", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeProjectRoot(geminiHome, "luke", "/Users/test/luke");
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-11112222",
    [
      metadataRecord("11112222-full-id", "2026-08-20T11:00:00.000Z"),
      geminiMessage("m1", "2026-08-20T11:01:00.000Z"),
      { $set: { summary: "Rename the settings panel rows", lastUpdated: "irrelevant" } },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "Rename the settings panel rows");
});

test("reports an open tool call as working, named by what it is for", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-deadbeef",
    [
      geminiMessage("m1", "2026-08-20T11:59:30.000Z", {
        toolCalls: [
          {
            id: "t1",
            name: "run_shell_command",
            args: { command: "pnpm test" },
            status: "success",
            timestamp: "2026-08-20T11:59:31.000Z",
            resultDisplay: SECRET_TRANSCRIPT_TEXT,
          },
          {
            id: "t2",
            name: "run_shell_command",
            displayName: "Shell",
            description: "Run the check suite",
            args: { command: "./scripts/check.sh" },
            status: "executing",
            timestamp: "2026-08-20T11:59:40.000Z",
          },
        ],
      }),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.detail?.activity, "Shell: Run the check suite");
  assert.equal(observations[0]?.observedAt, Date.parse("2026-08-20T11:59:40.000Z"));
});

test("reports a tool call holding for approval as waiting", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-feedface",
    [
      geminiMessage("m1", "2026-08-20T11:59:30.000Z", {
        toolCalls: [
          {
            id: "t1",
            name: "write_file",
            args: { file_path: "/Users/test/luke/README.md" },
            status: "awaiting_approval",
            timestamp: "2026-08-20T11:59:31.000Z",
          },
        ],
      }),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

test("reports the error that stopped a session", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-0badc0de",
    [
      userMessage("m1", "2026-08-20T11:58:00.000Z", SECRET_TRANSCRIPT_TEXT),
      { id: "m2", type: "error", timestamp: "2026-08-20T11:59:00.000Z", content: "Quota exceeded" },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[0]?.detail?.error, "Quota exceeded");
});

test("keeps a fresh prompt working and a stale one unknown", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "fresh",
    "session-2026-08-20T11-59-11110000",
    [userMessage("m1", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT)],
    TEST_TIME - 1_000,
  );
  await writeSessionFile(
    geminiHome,
    "stale",
    "session-2026-08-20T10-00-22220000",
    [userMessage("m1", "2026-08-20T10:00:00.000Z", SECRET_TRANSCRIPT_TEXT)],
    TEST_TIME - 2 * 60 * 60 * 1000,
  );

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
  });
  const observations = await adapter.observe();
  const byId = new Map(
    observations.map((observation) => [observation.providerSessionId, observation]),
  );

  assert.equal(byId.get("session-2026-08-20T11-59-11110000")?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get("session-2026-08-20T10-00-22220000")?.status, SESSION_STATUS.UNKNOWN);
});

test("lets a re-appended message line supersede its earlier one", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-5up3r5ed",
    [
      geminiMessage("m1", "2026-08-20T11:59:00.000Z", {
        toolCalls: [
          {
            id: "t1",
            name: "grep",
            args: {},
            status: "executing",
            timestamp: "2026-08-20T11:59:01.000Z",
          },
        ],
      }),
      geminiMessage("m1", "2026-08-20T11:59:00.000Z", {
        toolCalls: [
          {
            id: "t1",
            name: "grep",
            args: {},
            status: "success",
            timestamp: "2026-08-20T11:59:05.000Z",
          },
        ],
      }),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.detail?.activity, undefined);
});

test("honors a rewind by standing at the message before it", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-2ew1nded",
    [
      geminiMessage("m1", "2026-08-20T11:57:00.000Z"),
      userMessage("m2", "2026-08-20T11:58:00.000Z", SECRET_TRANSCRIPT_TEXT),
      geminiMessage("m3", "2026-08-20T11:59:00.000Z", {
        toolCalls: [
          {
            id: "t1",
            name: "grep",
            args: {},
            status: "executing",
            timestamp: "2026-08-20T11:59:01.000Z",
          },
        ],
      }),
      { $rewindTo: "m2" },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

test("never lets summary bookkeeping date a settled session", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-19T09-00-01dfaded",
    [
      userMessage("m1", "2026-08-19T09:00:00.000Z", SECRET_TRANSCRIPT_TEXT),
      geminiMessage("m2", "2026-08-19T09:01:00.000Z"),
      // The bookkeeping Gemini CLI appends at a later startup: a summary and
      // a lastUpdated bump, moving the file's clock a day after the turn.
      { $set: { summary: "Old session", lastUpdated: "2026-08-20T11:59:50.000Z" } },
    ],
    TEST_TIME - 10_000,
  );

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.observedAt, Date.parse("2026-08-19T09:01:00.000Z"));
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("labels a markerless project by its slug and a hash directory by nothing", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "my-repo-2",
    "session-2026-08-20T11-59-000aaa11",
    [userMessage("m1", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT)],
    TEST_TIME - 1_000,
  );
  await writeSessionFile(
    geminiHome,
    "b".repeat(64),
    "session-2026-08-20T11-59-000bbb22",
    [userMessage("m1", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT)],
    TEST_TIME - 1_000,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();
  const byId = new Map(
    observations.map((observation) => [observation.providerSessionId, observation]),
  );

  assert.equal(byId.get("session-2026-08-20T11-59-000aaa11")?.title, "my-repo-2");
  assert.equal(byId.get("session-2026-08-20T11-59-000bbb22")?.title, UNKNOWN_WORKSPACE_LABEL);
});

test("reads neither legacy JSON recordings nor subagent subdirectories", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-59-abcd1234",
    [userMessage("m1", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT)],
    TEST_TIME - 1_000,
  );
  const chatsDirectory = path.join(
    geminiHome,
    GEMINI_TMP_DIRECTORY,
    "luke",
    GEMINI_CHATS_DIRECTORY,
  );
  await fs.writeFile(
    path.join(chatsDirectory, "session-2026-01-01T00-00-1e9acy00.json"),
    JSON.stringify({ sessionId: "legacy", messages: [] }),
  );
  const subagentDirectory = path.join(chatsDirectory, "abcd1234-full-id");
  await fs.mkdir(subagentDirectory, { recursive: true });
  await fs.writeFile(
    path.join(subagentDirectory, "subagent-session.jsonl"),
    `${JSON.stringify(userMessage("m1", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT))}\n`,
  );

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-2026-08-20T11-59-abcd1234");
});

test("observes nothing where Gemini CLI has never run", async (t) => {
  const geminiHome = path.join(await temporaryGeminiHome(t), "missing");

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });

  assert.deepEqual(await adapter.observe(), []);
});

test("answers every write as unsupported", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);

  const adapter = new GeminiCliSessionAdapter({ geminiHome, now: () => TEST_TIME });

  assert.equal(
    (await adapter.sendMessage({ providerSessionId: "session-x", text: "hi" })).status,
    "unsupported",
  );
  assert.equal(adapter.workspaceProjects().length, 0);
});
