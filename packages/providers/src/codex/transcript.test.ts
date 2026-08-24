import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import type { SqliteModuleLoader } from "../shared/local-sqlite.js";
import { CodexSessionAdapter } from "./adapter.js";

async function readCodexSessionTranscript(request: {
  codexHome?: string;
  sqliteHome?: string;
  providerSessionId: string;
  sqlite?: SqliteModuleLoader;
  maximumRenderedLength?: number;
}): Promise<string | undefined> {
  const result = await new CodexSessionAdapter({
    codexHome: request.codexHome,
    sqliteHome: request.sqliteHome,
    sqlite: request.sqlite,
    transcriptMaximumRenderedLength: request.maximumRenderedLength,
  }).readTranscript(request.providerSessionId);
  return result.status === "accepted" ? result.transcript : undefined;
}

const TEST_SESSION_ID = "0198c1f2-4d5e-7789-abcd-ef0123456789";
const CODEX_STATE_DATABASE = "state_5.sqlite";

async function temporaryCodexHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-codex-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeThreadRow(
  codexHome: string,
  threadId: string,
  rolloutPath: string,
): Promise<void> {
  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        cwd TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )
    `);
    database
      .prepare(
        "INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd) VALUES (?, ?, 1, 1, ?)",
      )
      .run(threadId, rolloutPath, "/Users/test/luke");
  } finally {
    database.close();
  }
}

async function writeRollout(filePath: string, records: readonly ParsedJsonObject[]): Promise<void> {
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function writeSession(
  codexHome: string,
  records: readonly ParsedJsonObject[],
): Promise<void> {
  const rolloutPath = path.join(codexHome, `rollout-${TEST_SESSION_ID}.jsonl`);
  await writeThreadRow(codexHome, TEST_SESSION_ID, rolloutPath);
  await writeRollout(rolloutPath, records);
}

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("renders a session's turns as a bounded conversation", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeSession(codexHome, [
    {
      timestamp: "2026-08-16T20:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Fix the flaky test" }],
      },
    },
    {
      timestamp: "2026-08-16T20:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Looking at the failure now." }],
      },
    },
    {
      timestamp: "2026-08-16T20:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pnpm test"}',
        call_id: "call-1",
      },
    },
    {
      timestamp: "2026-08-16T20:00:03.000Z",
      type: "response_item",
      payload: { type: "function_call_output", call_id: "call-1", output: "1 failing: retries" },
    },
    {
      timestamp: "2026-08-16T20:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Fixed and green." }],
      },
    },
  ]);

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(
    rendered,
    [
      "Developer: Fix the flaky test",
      "Codex: Looking at the failure now.",
      "→ exec_command: pnpm test",
      "← 1 failing: retries",
      "Codex: Fixed and green.",
    ].join("\n"),
  );
});

test("skips Codex's scaffolding and keeps the developer's own words", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeSession(codexHome, [
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "<user_instructions>\nAlways be brief.\n</user_instructions>",
          },
        ],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "<environment_context>cwd=/x</environment_context>" },
        ],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "<environment_context>cwd=/x</environment_context>\n\n## My request for Codex:\nShip the release",
          },
        ],
      },
    },
  ]);

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, "Developer: Ship the release");
});

test("reads a shell call's answer out of the wrapped output shape", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeSession(codexHome, [
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: '{"output":"2 passed, 0 failed","metadata":{"exit_code":0,"duration_seconds":0.2}}',
      },
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-2",
        output: [{ type: "input_text", text: "listed 3 files" }],
      },
    },
  ]);

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, ["← 2 passed, 0 failed", "← listed 3 files"].join("\n"));
});

test("names a shell call and a search by what they ran", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeSession(codexHome, [
    {
      type: "response_item",
      payload: {
        type: "local_shell_call",
        status: "completed",
        action: { type: "exec", command: ["pnpm", "test"] },
      },
    },
    {
      type: "response_item",
      payload: { type: "web_search_call", action: { type: "search", query: "electron notch" } },
    },
  ]);

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, ["→ shell: pnpm test", "→ web_search: electron notch"].join("\n"));
});

test("reports the failure that ended a turn, from either event shape", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeSession(codexHome, [
    { type: "event_msg", payload: { type: "error", message: "stream disconnected" } },
    {
      type: "event_msg",
      payload: {
        type: "task_complete",
        last_agent_message: null,
        error: { message: "rate limited" },
      },
    },
    // The boundary events that carry no failure say nothing a message
    // does not already say.
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "agent_message", message: "duplicate words" } },
  ]);

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, ["Error: stream disconnected", "Error: rate limited"].join("\n"));
});

test("reads nothing for a thread the state database does not name", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeSession(codexHome, [
    {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    },
  ]);

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: "0000aaaa-1111-7222-3333-444455556666",
  });

  assert.equal(rendered, undefined);
});

test("leaves a compressed rollout unread rather than half-read", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, `rollout-${TEST_SESSION_ID}.jsonl.zst`);
  await writeThreadRow(codexHome, TEST_SESSION_ID, rolloutPath);
  await fs.writeFile(rolloutPath, "not actually zstd");

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, undefined);
});

test("reads nothing when Codex has no state database at all", async (t) => {
  const codexHome = await temporaryCodexHome(t);

  const rendered = await readCodexSessionTranscript({
    codexHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, undefined);
});
