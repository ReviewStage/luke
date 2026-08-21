import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { readGrokBuildSessionTranscript } from "./transcript.js";

const SESSION_ID = "01a02200-0000-7000-8000-0000000000aa";
const PROJECT_DIRECTORY = "%2FUsers%2Ftest%2Fluke";

async function temporaryGrokHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-grok-build-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeUpdates(
  grokHome: string,
  sessionId: string,
  updates: readonly ParsedJsonObject[],
): Promise<void> {
  const sessionDirectory = path.join(grokHome, "sessions", PROJECT_DIRECTORY, sessionId);
  await fs.mkdir(sessionDirectory, { recursive: true });
  await fs.writeFile(
    path.join(sessionDirectory, "updates.jsonl"),
    `${updates.map((update) => JSON.stringify(update)).join("\n")}\n`,
  );
}

function update(
  sessionUpdate: string,
  extra: ParsedJsonObject = {},
  method = "session/update",
): ParsedJsonObject {
  return {
    timestamp: 1787289935,
    method,
    params: { sessionId: SESSION_ID, update: { sessionUpdate, ...extra } },
  };
}

function messageChunk(kind: string, words: string): ParsedJsonObject {
  return update(kind, { content: { type: "text", text: words } });
}

test("renders a conversation with its tool calls and answers", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeUpdates(grokHome, SESSION_ID, [
    messageChunk("user_message_chunk", "Run the checks."),
    update("tool_call", {
      toolCallId: "call-1",
      title: "bash",
      rawInput: { command: "./scripts/check.sh", description: "Run the check suite" },
      _meta: { "x.ai/tool": { name: "run_terminal_command", label: "Run Command" } },
    }),
    update("tool_call_update", {
      toolCallId: "call-1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "All checks passed." } }],
    }),
    messageChunk("agent_message_chunk", "Everything is "),
    messageChunk("agent_message_chunk", "green."),
    update("turn_completed", { stop_reason: "end_turn" }, "_x.ai/session/update"),
  ]);

  const transcript = await readGrokBuildSessionTranscript({
    grokHome,
    providerSessionId: SESSION_ID,
  });

  assert.equal(
    transcript,
    [
      "Developer: Run the checks.",
      "→ Run Command: Run the check suite",
      "← All checks passed.",
      "Grok: Everything is green.",
    ].join("\n"),
  );
});

test("renders the failure a turn stopped on", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeUpdates(grokHome, SESSION_ID, [
    messageChunk("user_message_chunk", "Try again."),
    update(
      "turn_completed",
      { stop_reason: "error", agent_result: "API error (status 400 Bad Request): quota" },
      "_x.ai/session/update",
    ),
  ]);

  const transcript = await readGrokBuildSessionTranscript({
    grokHome,
    providerSessionId: SESSION_ID,
  });

  assert.equal(
    transcript,
    ["Developer: Try again.", "Error: API error (status 400 Bad Request): quota"].join("\n"),
  );
});

test("cuts a long conversation from the front and says so", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeUpdates(grokHome, SESSION_ID, [
    messageChunk("user_message_chunk", "First question, soon cut away."),
    messageChunk("agent_message_chunk", "First answer, soon cut away."),
    messageChunk("user_message_chunk", "Second question, kept."),
    messageChunk("agent_message_chunk", "Second answer, kept."),
  ]);

  const transcript = await readGrokBuildSessionTranscript({
    grokHome,
    providerSessionId: SESSION_ID,
    maximumRenderedLength: 60,
  });

  assert.ok(transcript !== undefined);
  assert.ok(transcript.startsWith("[earlier turns omitted]\n"));
  assert.ok(transcript.endsWith("Grok: Second answer, kept."));
  assert.ok(!transcript.includes("First question"));
});

test("names nothing for an id outside the shape the CLI mints", async (t) => {
  const grokHome = await temporaryGrokHome(t);
  await writeUpdates(grokHome, SESSION_ID, [messageChunk("user_message_chunk", "Hello.")]);

  assert.equal(
    await readGrokBuildSessionTranscript({ grokHome, providerSessionId: "../escape" }),
    undefined,
  );
  assert.equal(
    await readGrokBuildSessionTranscript({
      grokHome,
      providerSessionId: "01a02200-0000-7000-8000-0000000000bb",
    }),
    undefined,
  );
});
