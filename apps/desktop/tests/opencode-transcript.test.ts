import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { readOpenCodeSessionTranscript } from "../src/opencode-transcript";

const TEST_SESSION_ID = "ses_8f2f6a01aa";
const OPENCODE_DATABASE = "opencode.db";

interface TestMessage {
  id: string;
  time: number;
  data: Record<string, unknown>;
}

interface TestPart {
  id: string;
  messageId: string;
  time: number;
  data: Record<string, unknown>;
}

async function temporaryDataDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-opencode-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeOpenCodeState(
  dataDirectory: string,
  messages: readonly TestMessage[],
  parts: readonly TestPart[],
): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(dataDirectory, OPENCODE_DATABASE), {});
  try {
    database.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    for (const message of messages) {
      database
        .prepare(
          "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
        )
        .run(message.id, TEST_SESSION_ID, message.time, message.time, JSON.stringify(message.data));
    }
    for (const part of parts) {
      database
        .prepare(
          "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          part.id,
          part.messageId,
          TEST_SESSION_ID,
          part.time,
          part.time,
          JSON.stringify(part.data),
        );
    }
  } finally {
    database.close();
  }
}

test("renders a session's turns as a bounded conversation", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [
      { id: "msg_01", time: 1, data: { role: "user", time: { created: 1 } } },
      { id: "msg_02", time: 2, data: { role: "assistant", time: { created: 2, completed: 5 } } },
    ],
    [
      {
        id: "prt_01",
        messageId: "msg_01",
        time: 1,
        data: { type: "text", text: "Fix the flaky test" },
      },
      {
        id: "prt_02",
        messageId: "msg_02",
        time: 2,
        data: { type: "text", text: "Looking at the failure now." },
      },
      {
        id: "prt_03",
        messageId: "msg_02",
        time: 3,
        data: {
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "pnpm test" },
            output: "1 failing: retries",
            title: "pnpm test",
            metadata: {},
            time: { start: 3, end: 4 },
          },
        },
      },
      // A reasoning part is the model's own scratchpad, never a reply.
      { id: "prt_04", messageId: "msg_02", time: 4, data: { type: "reasoning", text: "hmm" } },
    ],
  );

  const rendered = await readOpenCodeSessionTranscript({
    dataDirectory,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(
    rendered,
    [
      "Developer: Fix the flaky test",
      "OpenCode: Looking at the failure now.",
      "→ bash: pnpm test",
      "← 1 failing: retries",
    ].join("\n"),
  );
  assert.ok(!rendered?.includes("hmm"));
});

test("keeps synthetic text and injected scaffolding out of the developer's mouth", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "msg_01", time: 1, data: { role: "user", time: { created: 1 } } }],
    [
      {
        id: "prt_01",
        messageId: "msg_01",
        time: 1,
        data: { type: "text", text: "injected context", synthetic: true },
      },
      {
        id: "prt_02",
        messageId: "msg_01",
        time: 2,
        data: { type: "text", text: "ignored words", ignored: true },
      },
      {
        id: "prt_03",
        messageId: "msg_01",
        time: 3,
        data: { type: "text", text: "Ship the release" },
      },
    ],
  );

  const rendered = await readOpenCodeSessionTranscript({
    dataDirectory,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, "Developer: Ship the release");
});

test("reports a turn's failure but never the stop the developer asked for", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [
      {
        id: "msg_01",
        time: 1,
        data: {
          role: "assistant",
          time: { created: 1 },
          error: { name: "APIError", data: { message: "rate limited" } },
        },
      },
      {
        id: "msg_02",
        time: 2,
        data: {
          role: "assistant",
          time: { created: 2 },
          error: { name: "MessageAbortedError", data: { message: "aborted" } },
        },
      },
    ],
    [
      {
        id: "prt_01",
        messageId: "msg_01",
        time: 1,
        data: { type: "text", text: "Trying the build." },
      },
      {
        id: "prt_02",
        messageId: "msg_02",
        time: 2,
        data: { type: "text", text: "Starting over." },
      },
    ],
  );

  const rendered = await readOpenCodeSessionTranscript({
    dataDirectory,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(
    rendered,
    ["OpenCode: Trying the build.", "Error: rate limited", "OpenCode: Starting over."].join("\n"),
  );
});

test("renders a failed tool call's own error as its answer", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "msg_01", time: 1, data: { role: "assistant", time: { created: 1 } } }],
    [
      {
        id: "prt_01",
        messageId: "msg_01",
        time: 1,
        data: {
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "error",
            input: { command: "pnpm test" },
            error: "command timed out",
            time: { start: 1, end: 2 },
          },
        },
      },
    ],
  );

  const rendered = await readOpenCodeSessionTranscript({
    dataDirectory,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, ["→ bash: pnpm test", "← command timed out"].join("\n"));
});

test("reads nothing for a session the database does not hold", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "msg_01", time: 1, data: { role: "user", time: { created: 1 } } }],
    [{ id: "prt_01", messageId: "msg_01", time: 1, data: { type: "text", text: "hello" } }],
  );

  const rendered = await readOpenCodeSessionTranscript({
    dataDirectory,
    providerSessionId: "ses_nowhere",
  });

  assert.equal(rendered, undefined);
});

test("reads nothing when OpenCode has no database at all", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);

  const rendered = await readOpenCodeSessionTranscript({
    dataDirectory,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(rendered, undefined);
});

test("a turn that outgrows the part bound keeps its newest parts", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  // Forty tool calls and then the concluding words: the bound must cut the
  // oldest calls, never the answer the turn actually ended on.
  const toolParts = Array.from({ length: 40 }, (_, index) => ({
    id: `prt_${String(index + 100)}`,
    messageId: "msg_01",
    time: index,
    data: {
      type: "tool",
      callID: `call-${index}`,
      tool: "bash",
      state: {
        status: "completed",
        input: { command: `step ${index}` },
        output: `output ${index}`,
        title: `step ${index}`,
        metadata: {},
        time: { start: index, end: index },
      },
    },
  }));
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "msg_01", time: 1, data: { role: "assistant", time: { created: 1, completed: 50 } } }],
    [
      ...toolParts,
      {
        // An id that sorts before every call's: OpenCode ids only sort in
        // creation order until their timestamp half wraps, so the row's own
        // clock — the newest here — is what has to decide the cut.
        id: "prt_000",
        messageId: "msg_01",
        time: 50,
        data: { type: "text", text: "All forty steps passed." },
      },
    ],
  );

  const rendered = await readOpenCodeSessionTranscript({
    dataDirectory,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.ok(rendered?.includes("OpenCode: All forty steps passed."));
  const lines = rendered?.split("\n") ?? [];
  assert.ok(lines.includes("→ bash: step 39"), "the newest call survives the cut");
  assert.ok(!lines.includes("→ bash: step 0"), "the oldest call is what goes");
});
