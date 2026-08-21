import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { GROK_BUILD_PROVIDER, GrokBuildSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-20T12:00:00.000Z");
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const GROK_SESSIONS_DIRECTORY = "sessions";
const LUKE_PROJECT_DIRECTORY = "%2FUsers%2Ftest%2Fluke";

const SESSION_ID = {
  SETTLED: "01a02200-0000-7000-8000-000000000001",
  HOLDING: "01a02200-0000-7000-8000-000000000002",
  WORKING: "01a02200-0000-7000-8000-000000000003",
  STALE: "01a02200-0000-7000-8000-000000000004",
  FAILED: "01a02200-0000-7000-8000-000000000005",
  CANCELLED: "01a02200-0000-7000-8000-000000000006",
  UNTITLED: "01a02200-0000-7000-8000-000000000007",
} as const;

async function temporaryGrokHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-grok-build-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

interface SessionRecordings {
  summary?: ParsedJsonObject;
  events?: readonly ParsedJsonObject[];
  updates?: readonly ParsedJsonObject[];
}

async function writeSession(
  grokHome: string,
  projectDirectoryName: string,
  sessionId: string,
  recordings: SessionRecordings,
  mtimeMs: number,
): Promise<string> {
  const sessionDirectory = path.join(
    grokHome,
    GROK_SESSIONS_DIRECTORY,
    projectDirectoryName,
    sessionId,
  );
  await fs.mkdir(sessionDirectory, { recursive: true });
  const jsonl = (records: readonly ParsedJsonObject[]) =>
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const files: [string, string][] = [];
  if (recordings.summary) {
    files.push(["summary.json", JSON.stringify(recordings.summary, null, 2)]);
  }
  if (recordings.events) files.push(["events.jsonl", jsonl(recordings.events)]);
  if (recordings.updates) files.push(["updates.jsonl", jsonl(recordings.updates)]);
  for (const [name, contents] of files) {
    const filePath = path.join(sessionDirectory, name);
    await fs.writeFile(filePath, contents);
    await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
  }
  return sessionDirectory;
}

function summaryDocument(
  sessionId: string,
  title: string,
  extra: ParsedJsonObject = {},
): ParsedJsonObject {
  return {
    info: { id: sessionId, cwd: "/Users/test/luke" },
    session_summary: title,
    created_at: "2026-08-20T11:50:00.000000Z",
    updated_at: "2026-08-20T11:59:00.000000Z",
    last_active_at: "2026-08-20T11:59:00.000000Z",
    num_messages: 3,
    current_model_id: "grok-4.6",
    generated_title: title,
    ...extra,
  };
}

function event(ts: string, type: string, extra: ParsedJsonObject = {}): ParsedJsonObject {
  return { ts, type, ...extra };
}

function update(
  sessionUpdate: string,
  extra: ParsedJsonObject = {},
  method = "session/update",
): ParsedJsonObject {
  return {
    timestamp: 1787289935,
    method,
    params: {
      sessionId: "irrelevant",
      update: { sessionUpdate, ...extra },
      _meta: { eventId: "irrelevant-1" },
    },
  };
}

function messageChunk(kind: string, words: string): ParsedJsonObject {
  return update(kind, { content: { type: "text", text: words } });
}

function turnCompleted(stopReason: string, extra: ParsedJsonObject = {}): ParsedJsonObject {
  return update("turn_completed", { stop_reason: stopReason, ...extra }, "_x.ai/session/update");
}

test("observes a settled Grok Build session with its title, model, and recap", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.SETTLED,
    {
      summary: summaryDocument(SESSION_ID.SETTLED, "Fix the flaky check"),
      events: [
        event("2026-08-20T11:58:00.000Z", "turn_started", { session_id: SESSION_ID.SETTLED }),
        event("2026-08-20T11:58:00.100Z", "phase_changed", { phase: "waiting_for_model" }),
        event("2026-08-20T11:58:01.000Z", "first_token"),
        event("2026-08-20T11:58:01.000Z", "phase_changed", { phase: "streaming_text" }),
        event("2026-08-20T11:59:00.000Z", "turn_ended", { outcome: "completed" }),
      ],
      updates: [
        messageChunk("user_message_chunk", SECRET_TRANSCRIPT_TEXT),
        messageChunk("agent_message_chunk", "Done; "),
        messageChunk("agent_message_chunk", "the tests pass."),
        turnCompleted("end_turn"),
      ],
    },
    TEST_TIME - 1_000,
  );

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, GROK_BUILD_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, SESSION_ID.SETTLED);
  assert.equal(observations[0]?.title, "Fix the flaky check");
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.observedAt, Date.parse("2026-08-20T11:59:00.000Z"));
  assert.equal(observations[0]?.detail?.repository, "luke");
  assert.equal(observations[0]?.detail?.model, "grok-4.6");
  assert.equal(observations[0]?.recap, "Done; the tests pass.");
  assert.equal(observations[0]?.holdingForDeveloper, undefined);
  assert.equal(observations[0]?.controls, undefined);
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("reports an open permission prompt as holding for the developer", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.HOLDING,
    {
      summary: summaryDocument(SESSION_ID.HOLDING, "Clean up the temp directory"),
      events: [
        event("2026-08-20T11:58:00.000Z", "turn_started", { session_id: SESSION_ID.HOLDING }),
        event("2026-08-20T11:58:01.000Z", "phase_changed", { phase: "tool_execution" }),
        event("2026-08-20T11:58:01.000Z", "tool_started", { tool_name: "run_terminal_command" }),
        event("2026-08-20T11:58:01.100Z", "phase_changed", { phase: "permission_prompt" }),
        event("2026-08-20T11:59:00.000Z", "permission_requested", {
          tool_name: "run_terminal_command",
        }),
      ],
      updates: [
        messageChunk("user_message_chunk", SECRET_TRANSCRIPT_TEXT),
        update("tool_call", { toolCallId: "call-1", title: "bash" }),
        update("tool_call_update", {
          toolCallId: "call-1",
          title: "Execute `rm -rf /tmp/scratch`",
          rawInput: { command: "rm -rf /tmp/scratch", description: "Clear the scratch space" },
          _meta: {
            "x.ai/tool": { name: "run_terminal_command", label: "Run Command" },
          },
        }),
      ],
    },
    TEST_TIME - 1_000,
  );

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.holdingForDeveloper, true);
  assert.equal(observations[0]?.detail?.activity, "Run Command: Clear the scratch space");
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("keeps a fresh turn working and decays a quiet one to unknown", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.WORKING,
    {
      summary: summaryDocument(SESSION_ID.WORKING, "Refactor the parser"),
      events: [
        event("2026-08-20T11:59:00.000Z", "turn_started", { session_id: SESSION_ID.WORKING }),
        event("2026-08-20T11:59:00.100Z", "phase_changed", { phase: "streaming_text" }),
      ],
      updates: [messageChunk("agent_message_chunk", SECRET_TRANSCRIPT_TEXT)],
    },
    TEST_TIME - 1_000,
  );
  await writeSession(
    grokHome,
    "%2FUsers%2Ftest%2Fother",
    SESSION_ID.STALE,
    {
      summary: summaryDocument(SESSION_ID.STALE, "Abandoned turn"),
      // A killed process leaves its last lifecycle event on disk forever; the
      // file clock stays fresh to prove the decay runs on the event's own.
      events: [
        event("2026-08-20T09:00:00.000Z", "turn_started", { session_id: SESSION_ID.STALE }),
        event("2026-08-20T09:00:00.100Z", "phase_changed", { phase: "waiting_for_model" }),
      ],
    },
    TEST_TIME - 1_000,
  );

  const adapter = new GrokBuildSessionAdapter({
    grokHome,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
  });
  const observations = await adapter.observe();
  const byId = new Map(
    observations.map((observation) => [observation.providerSessionId, observation]),
  );

  assert.equal(byId.get(SESSION_ID.WORKING)?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get(SESSION_ID.STALE)?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(byId.get(SESSION_ID.STALE)?.observedAt, Date.parse("2026-08-20T09:00:00.100Z"));
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("reports the error that stopped a turn", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.FAILED,
    {
      summary: summaryDocument(SESSION_ID.FAILED, "Ship the release"),
      events: [
        event("2026-08-20T11:58:00.000Z", "turn_started", { session_id: SESSION_ID.FAILED }),
        event("2026-08-20T11:59:00.000Z", "turn_ended", { outcome: "error" }),
      ],
      updates: [
        messageChunk("user_message_chunk", SECRET_TRANSCRIPT_TEXT),
        turnCompleted("error", { agent_result: "API error (status 400 Bad Request): quota" }),
      ],
    },
    TEST_TIME - 1_000,
  );

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[0]?.detail?.error, "API error (status 400 Bad Request): quota");
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("keeps a recap only for a turn that completed", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.CANCELLED,
    {
      summary: summaryDocument(SESSION_ID.CANCELLED, "Interrupted work"),
      events: [
        event("2026-08-20T11:58:00.000Z", "turn_started", { session_id: SESSION_ID.CANCELLED }),
        event("2026-08-20T11:59:00.000Z", "turn_ended", {
          outcome: "cancelled",
          cancellation_category: "permission_rejected",
        }),
      ],
      updates: [
        messageChunk("agent_message_chunk", SECRET_TRANSCRIPT_TEXT),
        turnCompleted("cancelled"),
      ],
    },
    TEST_TIME - 1_000,
  );

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.recap, undefined);
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("labels an unsummarized session by its decoded working directory", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.UNTITLED,
    {
      events: [
        event("2026-08-20T11:59:00.000Z", "turn_started", { session_id: SESSION_ID.UNTITLED }),
      ],
    },
    TEST_TIME - 1_000,
  );

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.detail?.repository, "luke");
});

test("reads only session directories, never the store's own bookkeeping", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.SETTLED,
    {
      summary: summaryDocument(SESSION_ID.SETTLED, "The one session"),
      events: [event("2026-08-20T11:59:00.000Z", "turn_ended", { outcome: "completed" })],
    },
    TEST_TIME - 1_000,
  );
  const projectDirectory = path.join(grokHome, GROK_SESSIONS_DIRECTORY, LUKE_PROJECT_DIRECTORY);
  await fs.writeFile(
    path.join(projectDirectory, "prompt_history.jsonl"),
    `${JSON.stringify({ prompt: SECRET_TRANSCRIPT_TEXT })}\n`,
  );
  await fs.writeFile(
    path.join(grokHome, GROK_SESSIONS_DIRECTORY, "session_search.sqlite"),
    "not a session",
  );
  const notASession = path.join(projectDirectory, "terminal");
  await fs.mkdir(notASession, { recursive: true });
  await fs.writeFile(path.join(notASession, "events.jsonl"), "{}\n");

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, SESSION_ID.SETTLED);
});

test("honors the CLI's own GROK_HOME override when no home is passed", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeSession(
    grokHome,
    LUKE_PROJECT_DIRECTORY,
    SESSION_ID.SETTLED,
    {
      summary: summaryDocument(SESSION_ID.SETTLED, "Found through the override"),
      events: [event("2026-08-20T11:59:00.000Z", "turn_ended", { outcome: "completed" })],
    },
    TEST_TIME - 1_000,
  );
  const previous = process.env.GROK_HOME;
  process.env.GROK_HOME = grokHome;
  t.after(() => {
    if (previous === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previous;
  });

  const adapter = new GrokBuildSessionAdapter({ now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "Found through the override");
});

test("observes nothing where Grok Build has never run", async (t) => {
  const grokHome = path.join(await temporaryGrokHome(t), "missing");

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });

  assert.deepEqual(await adapter.observe(), []);
});

test("answers every write as unsupported", async (t) => {
  const grokHome = await temporaryGrokHome(t);

  const adapter = new GrokBuildSessionAdapter({ grokHome, now: () => TEST_TIME });

  assert.equal(
    (await adapter.sendMessage({ providerSessionId: SESSION_ID.SETTLED, text: "hi" })).status,
    "unsupported",
  );
  assert.equal(adapter.workspaceProjects().length, 0);
});
