import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { readRadiusChatTranscript } from "./transcript.js";

const CHAT_ID = "chat:00000000-0000-4000-8000-000000000001";
const OTHER_CHAT_ID = "chat:00000000-0000-4000-8000-000000000002";
const TURN_START_MS = Date.parse("2026-08-20T11:00:00.000Z");

const RADIUS_SCHEMA = `
  CREATE TABLE turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
  );
  CREATE TABLE events (
    turn_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (turn_id, seq)
  );
`;

interface Turn {
  conversationId: string;
  events: readonly ParsedJsonObject[];
}

async function radiusStore(t: TestContext, turns: readonly Turn[]): Promise<string> {
  const radiusHome = await fs.mkdtemp(path.join(os.tmpdir(), "luke-radius-transcript-"));
  t.after(async () => {
    await fs.rm(radiusHome, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(radiusHome, "state"), { recursive: true });
  const database = new DatabaseSync(path.join(radiusHome, "state", "agent-chat.sqlite"));
  database.exec(RADIUS_SCHEMA);
  turns.forEach((turn, turnIndex) => {
    const turnId = `turn-${turnIndex + 1}`;
    database
      .prepare(`
        INSERT INTO turns (id, conversation_id, request_id, status, model, created_at)
        VALUES (?, ?, ?, 'completed', 'claude-code/opus-5', ?)
      `)
      .run(turnId, turn.conversationId, `request-${turnIndex + 1}`, TURN_START_MS + turnIndex);
    turn.events.forEach((payload, index) => {
      database
        .prepare(`
          INSERT INTO events (turn_id, seq, event_id, kind, created_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          turnId,
          index + 1,
          `${turnId}:${index + 1}`,
          String(payload.kind),
          TURN_START_MS + turnIndex,
          JSON.stringify(payload),
        );
    });
  });
  database.close();
  return radiusHome;
}

function agentEvent(kind: string, payload: ParsedJsonObject): ParsedJsonObject {
  return { protocol: "radius.agent.event", version: 1, kind, source: "claude-code", payload };
}

function message(role: string, words: string): ParsedJsonObject {
  return agentEvent("message.completed", { itemId: `msg-${role}`, role, text: words });
}

function toolStarted(toolId: string, toolName: string, args: ParsedJsonObject): ParsedJsonObject {
  return agentEvent("tool.started", { toolId, toolName, label: "Running", args });
}

test("renders the developer's asks, the agent's replies, and the tools it ran", async (t) => {
  const radiusHome = await radiusStore(t, [
    {
      conversationId: CHAT_ID,
      events: [
        message("user", "Add the Radius adapter"),
        message("assistant", "Reading the store first."),
        toolStarted("tool-1", "Bash", { description: "Dump the schema" }),
        agentEvent("tool.completed", { toolId: "tool-1", toolName: "Bash" }),
        message("assistant", "The adapter is in place."),
      ],
    },
  ]);

  const rendered = await readRadiusChatTranscript({ radiusHome, providerSessionId: CHAT_ID });

  assert.equal(
    rendered,
    [
      "Developer: Add the Radius adapter",
      "Radius: Reading the store first.",
      "→ Bash: Dump the schema",
      "Radius: The adapter is in place.",
    ].join("\n"),
  );
});

test("a call Radius announced twice takes one line", async (t) => {
  const radiusHome = await radiusStore(t, [
    {
      conversationId: CHAT_ID,
      events: [
        toolStarted("tool-1", "Bash", { command: "ls" }),
        toolStarted("tool-1", "Bash", { command: "ls" }),
        agentEvent("tool.completed", { toolId: "tool-1", toolName: "Bash" }),
      ],
    },
  ]);

  const rendered = await readRadiusChatTranscript({ radiusHome, providerSessionId: CHAT_ID });

  assert.equal(rendered, "→ Bash: ls");
});

test("reads only the chat asked about", async (t) => {
  const radiusHome = await radiusStore(t, [
    { conversationId: CHAT_ID, events: [message("assistant", "Mine")] },
    { conversationId: OTHER_CHAT_ID, events: [message("assistant", "Not mine")] },
  ]);

  const rendered = await readRadiusChatTranscript({ radiusHome, providerSessionId: CHAT_ID });

  assert.equal(rendered, "Radius: Mine");
});

test("renders a chat's turns oldest first", async (t) => {
  const radiusHome = await radiusStore(t, [
    { conversationId: CHAT_ID, events: [message("user", "First ask")] },
    { conversationId: CHAT_ID, events: [message("user", "Second ask")] },
  ]);

  const rendered = await readRadiusChatTranscript({ radiusHome, providerSessionId: CHAT_ID });

  assert.equal(rendered, ["Developer: First ask", "Developer: Second ask"].join("\n"));
});

test("cuts an overlong rendering from the front and says so", async (t) => {
  const radiusHome = await radiusStore(t, [
    {
      conversationId: CHAT_ID,
      events: [message("user", "The oldest ask"), message("assistant", "The newest reply")],
    },
  ]);

  const rendered = await readRadiusChatTranscript({
    radiusHome,
    providerSessionId: CHAT_ID,
    maximumRenderedLength: 30,
  });

  assert.match(rendered ?? "", /^\[earlier turns omitted\]\n/u);
  assert.match(rendered ?? "", /The newest reply$/u);
  assert.doesNotMatch(rendered ?? "", /The oldest ask/u);
});

test("renders nothing for a chat the store does not hold", async (t) => {
  const radiusHome = await radiusStore(t, [
    { conversationId: OTHER_CHAT_ID, events: [message("assistant", "Not mine")] },
  ]);

  assert.equal(
    await readRadiusChatTranscript({ radiusHome, providerSessionId: CHAT_ID }),
    undefined,
  );
});

test("renders nothing where the browser has never run", async (t) => {
  const radiusHome = await fs.mkdtemp(path.join(os.tmpdir(), "luke-radius-absent-"));
  t.after(async () => {
    await fs.rm(radiusHome, { recursive: true, force: true });
  });

  assert.equal(
    await readRadiusChatTranscript({ radiusHome, providerSessionId: CHAT_ID }),
    undefined,
  );
});
