import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { SESSION_COMPLETION_CAUSE, SESSION_STATUS } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { OMP_PROVIDER, OmpSessionAdapter } from "./adapter.js";
import { OMP_SESSIONS_DIRECTORY } from "./records.js";

const TEST_TIME = Date.parse("2026-08-20T12:00:00.000Z");
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const SESSION_ID = {
  SETTLED: "01a0540a-c238-7264-80d8-546b0c7be0d8",
  WORKING: "01a0540a-c238-7264-80d8-546b0c7be0d9",
  PROMPT: "01a0540a-c238-7264-80d8-546b0c7be0da",
  STALE: "01a0540a-c238-7264-80d8-546b0c7be0db",
  CLOSED: "01a0540a-c238-7264-80d8-546b0c7be0dc",
  FAILED: "01a0540a-c238-7264-80d8-546b0c7be0dd",
  UNTITLED: "01a0540a-c238-7264-80d8-546b0c7be0de",
} as const;

async function temporaryOmpHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-omp-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function sessionFileName(id: string): string {
  return `2026-08-20T11-58-00-000Z_${id}.jsonl`;
}

async function writeSessionFile(
  ompHome: string,
  projectDirectoryName: string,
  sessionId: string,
  records: readonly ParsedJsonObject[],
  mtimeMs: number,
): Promise<void> {
  const projectDirectory = path.join(ompHome, OMP_SESSIONS_DIRECTORY, projectDirectoryName);
  await fs.mkdir(projectDirectory, { recursive: true });
  const filePath = path.join(projectDirectory, sessionFileName(sessionId));
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

function titleSlot(title: string): ParsedJsonObject {
  return { type: "title", v: 1, title, updatedAt: "2026-08-20T11:58:00.000Z", pad: "" };
}

function sessionHeader(id: string, cwd: string, title?: string): ParsedJsonObject {
  if (title) {
    return {
      type: "session",
      version: 3,
      id,
      timestamp: "2026-08-20T11:58:00.000Z",
      cwd,
      title,
    };
  }
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-08-20T11:58:00.000Z",
    cwd,
  };
}

function userMessage(id: string, timestamp: string, words: string): ParsedJsonObject {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "user",
      content: [{ type: "text", text: words }],
      timestamp: Date.parse(timestamp),
    },
  };
}

function assistantMessage(
  id: string,
  timestamp: string,
  extra: ParsedJsonObject = {},
): ParsedJsonObject {
  const { content, ...rest } = extra;
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "assistant",
      content: content ?? [{ type: "text", text: "Parting words." }],
      model: "grok-4.6",
      provider: "xai-oauth",
      stopReason: "stop",
      timestamp: Date.parse(timestamp),
      ...rest,
    },
  };
}

test("observes a settled OMP session and labels it by its project", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "luke",
    SESSION_ID.SETTLED,
    [
      titleSlot("Fix the flaky check"),
      sessionHeader(SESSION_ID.SETTLED, "/Users/test/luke"),
      userMessage("m1", "2026-08-20T11:58:10.000Z", SECRET_TRANSCRIPT_TEXT),
      assistantMessage("m2", "2026-08-20T11:59:00.000Z", {
        content: [{ type: "text", text: "Done; the tests pass." }],
      }),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, OMP_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, SESSION_ID.SETTLED);
  assert.equal(observations[0]?.title, "Fix the flaky check");
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.observedAt, Date.parse("2026-08-20T11:59:00.000Z"));
  assert.equal(observations[0]?.detail?.repository, "luke");
  assert.equal(observations[0]?.detail?.model, "grok-4.6");
  assert.equal(observations[0]?.controls, undefined);
  assert.equal(observations[0]?.recap, "Done; the tests pass.");
});

test("titles a session from the header when the slot is empty", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "luke",
    SESSION_ID.UNTITLED,
    [
      titleSlot(""),
      sessionHeader(SESSION_ID.UNTITLED, "/Users/test/luke", "Rename the settings panel rows"),
      assistantMessage("m1", "2026-08-20T11:59:00.000Z"),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "Rename the settings panel rows");
});

test("labels an untitled session by its working directory", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "encoded-cwd",
    SESSION_ID.UNTITLED,
    [
      titleSlot(""),
      sessionHeader(SESSION_ID.UNTITLED, "/Users/test/luke"),
      assistantMessage("m1", "2026-08-20T11:59:00.000Z"),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.detail?.repository, "luke");
});

test("reports an open tool call as working, named by what it is for", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "luke",
    SESSION_ID.WORKING,
    [
      titleSlot("Run the checks"),
      sessionHeader(SESSION_ID.WORKING, "/Users/test/luke"),
      assistantMessage("m1", "2026-08-20T11:59:30.000Z", {
        content: [
          { type: "text", text: SECRET_TRANSCRIPT_TEXT },
          {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: { command: "./scripts/check.sh" },
            intent: "Run the check suite",
          },
        ],
        stopReason: "stop",
      }),
      {
        type: "custom",
        customType: "tool_execution_start",
        id: "c1",
        parentId: "m1",
        timestamp: "2026-08-20T11:59:40.000Z",
        data: {
          toolCallId: "call-1",
          toolName: "bash",
          intent: "Run the check suite",
          startedAt: "2026-08-20T11:59:40.000Z",
        },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.detail?.activity, "bash: Run the check suite");
  assert.equal(observations[0]?.recap, undefined);
  assert.equal(observations[0]?.observedAt, Date.parse("2026-08-20T11:59:40.000Z"));
});

test("keeps a recap only for a turn that settled cleanly", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "luke",
    SESSION_ID.PROMPT,
    [
      titleSlot(""),
      sessionHeader(SESSION_ID.PROMPT, "/Users/test/luke"),
      assistantMessage("m1", "2026-08-20T11:58:00.000Z"),
      userMessage("m2", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.recap, undefined);
});

test("keeps a fresh prompt working and a stale one unknown", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "fresh",
    SESSION_ID.PROMPT,
    [
      titleSlot(""),
      sessionHeader(SESSION_ID.PROMPT, "/Users/test/fresh"),
      userMessage("m1", "2026-08-20T11:59:00.000Z", SECRET_TRANSCRIPT_TEXT),
    ],
    TEST_TIME - 1_000,
  );
  await writeSessionFile(
    ompHome,
    "stale",
    SESSION_ID.STALE,
    [
      titleSlot(""),
      sessionHeader(SESSION_ID.STALE, "/Users/test/stale"),
      userMessage("m1", "2026-08-20T10:00:00.000Z", SECRET_TRANSCRIPT_TEXT),
    ],
    TEST_TIME - 2 * 60 * 60 * 1000,
  );

  const adapter = new OmpSessionAdapter({
    ompHome,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
  });
  const observations = await adapter.observe();
  const byId = new Map(
    observations.map((observation) => [observation.providerSessionId, observation]),
  );

  assert.equal(byId.get(SESSION_ID.PROMPT)?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get(SESSION_ID.STALE)?.status, SESSION_STATUS.UNKNOWN);
});

test("a session_exit completes the row", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "luke",
    SESSION_ID.CLOSED,
    [
      titleSlot("Ship the adapter"),
      sessionHeader(SESSION_ID.CLOSED, "/Users/test/luke"),
      assistantMessage("m1", "2026-08-20T11:59:00.000Z"),
      {
        type: "custom",
        customType: "session_exit",
        id: "x1",
        parentId: "m1",
        timestamp: "2026-08-20T11:59:30.000Z",
        data: { reason: "normal", kind: "normal", recordedAt: "2026-08-20T11:59:30.000Z" },
      },
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
  assert.equal(observations[0]?.completionCause, SESSION_COMPLETION_CAUSE.SESSION_CLOSED);
});

test("reports the error that stopped a session", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "luke",
    SESSION_ID.FAILED,
    [
      titleSlot(""),
      sessionHeader(SESSION_ID.FAILED, "/Users/test/luke"),
      assistantMessage("m1", "2026-08-20T11:59:00.000Z", {
        content: [{ type: "text", text: "Provider rejected the request." }],
        isError: true,
      }),
    ],
    TEST_TIME - 1_000,
  );

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[0]?.detail?.error, "Provider rejected the request.");
});

test("reads neither sidecar blob directories nor files that are not sessions", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(
    ompHome,
    "luke",
    SESSION_ID.SETTLED,
    [
      titleSlot("Keep this row"),
      sessionHeader(SESSION_ID.SETTLED, "/Users/test/luke"),
      assistantMessage("m1", "2026-08-20T11:59:00.000Z"),
    ],
    TEST_TIME - 1_000,
  );
  const projectDirectory = path.join(ompHome, OMP_SESSIONS_DIRECTORY, "luke");
  await fs.mkdir(
    path.join(projectDirectory, sessionFileName(SESSION_ID.SETTLED).slice(0, -".jsonl".length)),
    {
      recursive: true,
    },
  );
  await fs.writeFile(path.join(projectDirectory, "notes.txt"), "not a session\n");

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, SESSION_ID.SETTLED);
});

test("observes nothing where OMP has never run", async (t) => {
  const ompHome = path.join(await temporaryOmpHome(t), "missing");

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });

  assert.deepEqual(await adapter.observe(), []);
});

test("answers every write as unsupported", async (t) => {
  const ompHome = await temporaryOmpHome(t);

  const adapter = new OmpSessionAdapter({ ompHome, now: () => TEST_TIME });

  assert.equal(
    (await adapter.sendMessage({ providerSessionId: SESSION_ID.SETTLED, text: "hi" })).status,
    "unsupported",
  );
  assert.equal(adapter.workspaceProjects().length, 0);
});
