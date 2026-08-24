import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import type { MutableWireRecord, ParsedJsonObject } from "@sidecar/wire/testing";
import { OMISSION_MARKER } from "../shared/local-transcript.js";
import { DevinLocalSessionAdapter } from "./local-adapter.js";

async function readDevinSessionTranscript(request: {
  cliDirectory?: string;
  providerSessionId: string;
  maximumRenderedLength?: number;
}): Promise<string | undefined> {
  const result = await new DevinLocalSessionAdapter({
    cliDirectory: request.cliDirectory,
    transcriptMaximumRenderedLength: request.maximumRenderedLength,
  }).readTranscript(request.providerSessionId);
  return result.status === "accepted" ? result.transcript : undefined;
}

const TEST_TIME_S = Math.floor(Date.parse("2026-08-18T21:30:00.000Z") / 1000);
const DEVIN_DATABASE = "sessions.db";

interface TestNode {
  nodeId: number;
  parentNodeId?: number;
  message: ParsedJsonObject;
}

async function temporaryCliDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-devin-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeDevinSession(
  cliDirectory: string,
  sessionId: string,
  mainChainId: number | undefined,
  nodes: readonly TestNode[],
): Promise<void> {
  await fs.mkdir(cliDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(cliDirectory, DEVIN_DATABASE), {});
  try {
    database.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        working_directory TEXT NOT NULL,
        backend_type TEXT NOT NULL,
        model TEXT NOT NULL,
        agent_mode TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        title TEXT,
        main_chain_id INTEGER,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE message_nodes (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        node_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        chat_message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, node_id)
      );
    `);
    database
      .prepare(
        "INSERT INTO sessions VALUES (?, '/Users/test/luke', 'windsurf', '', 'auto', ?, ?, ?, ?, 0)",
      )
      .run(sessionId, TEST_TIME_S, TEST_TIME_S, "A test session", mainChainId ?? null);
    for (const node of nodes) {
      database
        .prepare("INSERT INTO message_nodes VALUES (NULL, ?, ?, ?, ?, ?)")
        .run(
          sessionId,
          node.nodeId,
          node.parentNodeId ?? null,
          JSON.stringify(node.message),
          TEST_TIME_S,
        );
    }
  } finally {
    database.close();
  }
}

function message(
  role: string,
  content: string,
  options: { messageId?: string; toolCalls?: readonly ParsedJsonObject[] } = {},
): ParsedJsonObject {
  const payload: MutableWireRecord = {
    message_id: options.messageId ?? `msg-${role}-${content.length}`,
    role,
    content,
  };
  if (options.toolCalls) {
    payload.tool_calls = options.toolCalls;
  }
  return payload;
}

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("renders the main chain as a conversation with tool calls and answers", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinSession(cliDirectory, "leaf-flax", 4, [
    { nodeId: 0, message: message("system", "You are Devin, a command line agent.") },
    { nodeId: 1, parentNodeId: 0, message: message("user", "Fix the flaky panel test") },
    {
      nodeId: 2,
      parentNodeId: 1,
      message: message("assistant", "Let me run it first.", {
        toolCalls: [
          { id: "call-1", name: "exec", arguments: JSON.stringify({ command: "pnpm test" }) },
        ],
      }),
    },
    { nodeId: 3, parentNodeId: 2, message: message("tool", "1 test failed: panel motion") },
    { nodeId: 4, parentNodeId: 3, message: message("assistant", "Fixed the spring token.") },
  ]);

  const transcript = await readDevinSessionTranscript({
    cliDirectory,
    providerSessionId: "leaf-flax",
  });

  assert.equal(
    transcript,
    [
      "Developer: Fix the flaky panel test",
      "Devin: Let me run it first.",
      "→ exec: pnpm test",
      "← 1 test failed: panel motion",
      "Devin: Fixed the spring token.",
    ].join("\n"),
  );
  assert.ok(!transcript?.includes("You are Devin"));
});

test("keeps each message's newest copy when an old session has no chain tip", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  // Compaction re-inserted the same messages under fresh nodes.
  await writeDevinSession(cliDirectory, "compacted", undefined, [
    { nodeId: 0, message: message("user", "hello", { messageId: "m-1" }) },
    {
      nodeId: 1,
      parentNodeId: 0,
      message: message("assistant", "Hi there!", { messageId: "m-2" }),
    },
    { nodeId: 2, message: message("user", "hello", { messageId: "m-1" }) },
    {
      nodeId: 3,
      parentNodeId: 2,
      message: message("assistant", "Hi there!", { messageId: "m-2" }),
    },
  ]);

  const transcript = await readDevinSessionTranscript({
    cliDirectory,
    providerSessionId: "compacted",
  });

  assert.equal(transcript, ["Developer: hello", "Devin: Hi there!"].join("\n"));
});

test("cuts a long conversation from the front and says so", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinSession(cliDirectory, "long-run", 2, [
    { nodeId: 0, message: message("user", "First question about the panel and its motion") },
    { nodeId: 1, parentNodeId: 0, message: message("assistant", "A first considered answer") },
    { nodeId: 2, parentNodeId: 1, message: message("assistant", "The final answer") },
  ]);

  const transcript = await readDevinSessionTranscript({
    cliDirectory,
    providerSessionId: "long-run",
    maximumRenderedLength: 60,
  });

  assert.ok(transcript?.startsWith(OMISSION_MARKER));
  assert.ok(transcript?.includes("The final answer"));
});

test("answers nothing for a session the database does not hold", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinSession(cliDirectory, "leaf-flax", undefined, [
    { nodeId: 0, message: message("user", "hello") },
  ]);

  assert.equal(
    await readDevinSessionTranscript({ cliDirectory, providerSessionId: "unknown-session" }),
    undefined,
  );
});

test("answers nothing where the Devin CLI has never run", async (t) => {
  const cliDirectory = path.join(await temporaryCliDirectory(t), "missing");
  assert.equal(
    await readDevinSessionTranscript({ cliDirectory, providerSessionId: "leaf-flax" }),
    undefined,
  );
});
