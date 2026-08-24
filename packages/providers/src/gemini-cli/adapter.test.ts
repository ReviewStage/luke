import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/session";
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
  assert.equal(observations[0]?.holdingForDeveloper, true);
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

// ---------------------------------------------------------------------------
// Hook-event refinement. Every test here layers a spool the observation hook
// would have written over a recording, because that is the arrangement in
// production: the tail is always read, and the event only sharpens it. The
// spool is keyed by the full session id the recording's metadata line names,
// never by the file stem the adapter reports as `providerSessionId`.
// ---------------------------------------------------------------------------

const FULL_SESSION_ID = "abcd1234-4d5e-6789-abcd-ef0123456789";

async function temporaryHookSpool(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-gemini-spool-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeHookEvent(
  spoolDirectory: string,
  sessionId: string,
  event: string,
  mtimeMs: number,
): Promise<void> {
  const filePath = path.join(spoolDirectory, `${sessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify({ event }));
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

/** A recording mid-turn: the reply reached for a tool that has not returned. */
function midTurnRecords(timestamp: string): ParsedJsonObject[] {
  return [
    metadataRecord(FULL_SESSION_ID, "2026-08-20T11:00:00.000Z"),
    geminiMessage("m1", timestamp, {
      toolCalls: [
        {
          id: "t1",
          name: "run_shell_command",
          args: { command: "pnpm test" },
          status: "executing",
          timestamp,
        },
      ],
    }),
  ];
}

/** A recording whose last turn settled cleanly. */
function settledRecords(timestamp: string): ParsedJsonObject[] {
  return [
    metadataRecord(FULL_SESSION_ID, "2026-08-20T11:00:00.000Z"),
    geminiMessage("m1", timestamp),
  ];
}

test("a session-end event completes a row nothing in the recording could settle", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    settledRecords("2026-08-20T11:40:00.000Z"),
    TEST_TIME - 5 * 60 * 1000,
  );
  await writeHookEvent(spool, FULL_SESSION_ID, "session-end", TEST_TIME - 60_000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.COMPLETE);
  assert.equal(observation?.completionCause, SESSION_COMPLETION_CAUSE.SESSION_CLOSED);
  // The event also dates the session: the spool is written only by Luke's own
  // script, so its clock cannot suffer the recordings' bulk-touch problem.
  assert.equal(observation?.observedAt, TEST_TIME - 60_000);
});

test("a permission prompt the tail has not written yet turns the row to waiting", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  // Mid-turn by every record: the CLI can hold a confirmation before the
  // awaiting call reaches the recording, so without the event this session
  // reads as working.
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    midTurnRecords("2026-08-20T11:40:00.000Z"),
    TEST_TIME - 5 * 60 * 1000,
  );
  await writeHookEvent(spool, FULL_SESSION_ID, "notification", TEST_TIME - 60_000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
  assert.equal(observation?.observedAt, TEST_TIME - 60_000);
});

test("a permission hold that outlives the freshness window is still an ask", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  // A standing notification is proof the confirmation is still up — the hold
  // writes no records, so any record at or past it would have discarded it —
  // and an ask still asking must not melt into an idle row however long it
  // has stood.
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    midTurnRecords("2026-08-20T11:40:00.000Z"),
    TEST_TIME - 20 * 60 * 1000,
  );
  await writeHookEvent(spool, FULL_SESSION_ID, "notification", TEST_TIME - 18 * 60_000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
});

test("a stop event keeps a finished turn waiting past the freshness decay", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  // Twenty minutes past the last record, the tail alone decays to unknown.
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    settledRecords("2026-08-20T11:40:00.000Z"),
    TEST_TIME - 20 * 60 * 1000,
  );
  await writeHookEvent(spool, FULL_SESSION_ID, "stop", TEST_TIME - 60_000);

  const adapter = new GeminiCliSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("an event the conversation has moved past refines nothing", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    midTurnRecords("2026-08-20T11:59:00.000Z"),
    TEST_TIME - 60_000,
  );
  // A stop from a minute before the conversation's last record: hooks were
  // off, or the write raced. The session is demonstrably mid-turn again.
  await writeHookEvent(spool, FULL_SESSION_ID, "stop", TEST_TIME - 2 * 60 * 1000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.observedAt, Date.parse("2026-08-20T11:59:00.000Z"));
});

test("a notification the conversation has answered stands down at once", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  // The permission was granted and the tool ran: a record newer than the
  // notification, though within the tolerance the other events enjoy.
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    midTurnRecords("2026-08-20T11:59:59.000Z"),
    TEST_TIME - 1_000,
  );
  await writeHookEvent(spool, FULL_SESSION_ID, "notification", TEST_TIME - 3_000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a stop event does not unsay an error the CLI recorded", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    [
      metadataRecord(FULL_SESSION_ID, "2026-08-20T11:00:00.000Z"),
      { id: "m1", type: "error", timestamp: "2026-08-20T11:59:00.000Z", content: "Quota exceeded" },
    ],
    TEST_TIME - 60_000,
  );
  await writeHookEvent(spool, FULL_SESSION_ID, "stop", TEST_TIME - 59_000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
});

test("the spool joins on the metadata line's full id, never the file stem", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    geminiHome,
    "stemmed",
    "session-2026-08-20T11-00-abcd1234",
    settledRecords("2026-08-20T11:40:00.000Z"),
    TEST_TIME - 5 * 60 * 1000,
  );
  // A recording whose slice carries no metadata line offers nothing to join.
  await writeSessionFile(
    geminiHome,
    "unnamed",
    "session-2026-08-20T11-00-00000000",
    [geminiMessage("m1", "2026-08-20T11:59:00.000Z")],
    TEST_TIME - 60_000,
  );
  await writeHookEvent(
    spool,
    "session-2026-08-20T11-00-abcd1234",
    "session-end",
    TEST_TIME - 60_000,
  );
  await writeHookEvent(spool, FULL_SESSION_ID, "session-end", TEST_TIME - 60_000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();
  const byId = new Map(
    observations.map((observation) => [observation.providerSessionId, observation]),
  );

  assert.equal(byId.get("session-2026-08-20T11-00-abcd1234")?.status, SESSION_STATUS.COMPLETE);
  assert.equal(byId.get("session-2026-08-20T11-00-00000000")?.status, SESSION_STATUS.WAITING);
  assert.equal(byId.get("session-2026-08-20T11-00-00000000")?.completionCause, undefined);
});

test("a spool that cannot be read costs only the refinement", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    midTurnRecords("2026-08-20T11:59:00.000Z"),
    TEST_TIME - 60_000,
  );

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => path.join(geminiHome, "no-such-spool"),
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a prompt event never clears the hold the recording already shows", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  const spool = await temporaryHookSpool(t);
  await writeSessionFile(
    geminiHome,
    "luke",
    "session-2026-08-20T11-00-abcd1234",
    [
      metadataRecord(FULL_SESSION_ID, "2026-08-20T11:00:00.000Z"),
      geminiMessage("m1", "2026-08-20T11:59:58.000Z", {
        toolCalls: [
          {
            id: "t1",
            name: "write_file",
            args: { file_path: "/Users/test/luke/README.md" },
            status: "awaiting_approval",
            timestamp: "2026-08-20T11:59:58.000Z",
          },
        ],
      }),
    ],
    TEST_TIME - 1_000,
  );
  // The prompt opened the very turn now holding, so it stands newer than the
  // record — and must still lose to it.
  await writeHookEvent(spool, FULL_SESSION_ID, "prompt", TEST_TIME - 1_000);

  const adapter = new GeminiCliSessionAdapter({
    geminiHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
});
