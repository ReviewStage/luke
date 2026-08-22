import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { PROVIDER_ID, SESSION_STATUS } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { RADIUS_PROVIDER, RadiusSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-20T12:00:00.000Z");
const MINUTE_MS = 60_000;
const LUKE_PROJECT_PATH = "/Users/test/luke";
const LUKE_PROJECT_ID = "project:%2FUsers%2Ftest%2Fluke";

const CHAT_ID = {
  SETTLED: "chat:00000000-0000-4000-8000-000000000001",
  WORKING: "chat:00000000-0000-4000-8000-000000000002",
  FAILED: "chat:00000000-0000-4000-8000-000000000003",
  STOPPED: "chat:00000000-0000-4000-8000-000000000004",
  ARCHIVED: "chat:00000000-0000-4000-8000-000000000005",
  UNTOUCHED: "chat:00000000-0000-4000-8000-000000000006",
  STALE: "chat:00000000-0000-4000-8000-000000000007",
} as const;

/**
 * The tables Radius creates, copied from the store the browser writes so a
 * fixture cannot drift into a shape the adapter would never meet.
 */
const RADIUS_SCHEMA = `
  CREATE TABLE chat_conversations (
    conversation_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    persistence_root_path TEXT NOT NULL,
    label TEXT NOT NULL,
    preview TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    last_message_at INTEGER,
    workspace_kind TEXT NOT NULL DEFAULT 'unknown',
    project_id TEXT,
    project_path TEXT,
    project_label TEXT,
    profile_id TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    active_turn_index INTEGER,
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

async function temporaryRadiusHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-radius-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

interface StoreWriter {
  chat(options: {
    conversationId: string;
    label: string;
    updatedAt: number;
    projectPath?: string;
    projectLabel?: string;
    projectId?: string;
    archived?: boolean;
  }): void;
  turn(options: {
    conversationId: string;
    status: string;
    model: string;
    createdAt: number;
    completedAt?: number;
    error?: string;
    events?: readonly ParsedJsonObject[];
  }): void;
}

async function radiusStore(
  t: TestContext,
  write: (store: StoreWriter) => void,
  schema = RADIUS_SCHEMA,
): Promise<string> {
  const radiusHome = await temporaryRadiusHome(t);
  await fs.mkdir(path.join(radiusHome, "state"), { recursive: true });
  const database = new DatabaseSync(path.join(radiusHome, "state", "agent-chat.sqlite"));
  database.exec(schema);
  let turnOrdinal = 0;
  write({
    chat: (options) => {
      database
        .prepare(`
          INSERT INTO chat_conversations (
            conversation_id, session_id, scope_id, persistence_root_path, label,
            created_at, updated_at, last_used_at, last_message_at, workspace_kind,
            project_id, project_path, project_label, archived
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'project', ?, ?, ?, ?)
        `)
        .run(
          options.conversationId,
          options.conversationId,
          `scope:${LUKE_PROJECT_ID}`,
          options.projectPath ?? LUKE_PROJECT_PATH,
          options.label,
          options.updatedAt,
          options.updatedAt,
          options.updatedAt,
          options.updatedAt,
          options.projectId ?? LUKE_PROJECT_ID,
          options.projectPath ?? LUKE_PROJECT_PATH,
          options.projectLabel ?? "luke",
          options.archived ? 1 : 0,
        );
    },
    turn: (options) => {
      turnOrdinal += 1;
      const turnId = `turn-${turnOrdinal}`;
      database
        .prepare(`
          INSERT INTO turns (
            id, conversation_id, request_id, status, model, created_at, completed_at, error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          turnId,
          options.conversationId,
          `request-${turnOrdinal}`,
          options.status,
          options.model,
          options.createdAt,
          options.completedAt ?? null,
          options.error ?? null,
        );
      (options.events ?? []).forEach((payload, index) => {
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
            options.createdAt + index,
            JSON.stringify(payload),
          );
      });
    },
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

function toolCompleted(toolId: string, toolName: string): ParsedJsonObject {
  return agentEvent("tool.completed", { toolId, toolName, label: "Ran" });
}

function adapterFor(radiusHome: string, now = TEST_TIME): RadiusSessionAdapter {
  return new RadiusSessionAdapter({ radiusHome, now: () => now });
}

test("observes a settled chat with its title, agent, model, and parting words", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.SETTLED,
      label: "Add the Radius adapter",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.SETTLED,
      status: "completed",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - 2 * MINUTE_MS,
      completedAt: TEST_TIME - MINUTE_MS,
      events: [
        message("user", "Add the adapter"),
        toolStarted("tool-1", "Bash", { description: "Run the tests" }),
        toolCompleted("tool-1", "Bash"),
        message("assistant", "The adapter is in place and the tests pass."),
      ],
    });
  });

  const [observation, ...rest] = await adapterFor(radiusHome).observe();

  assert.equal(rest.length, 0);
  assert.equal(observation?.providerSessionId, CHAT_ID.SETTLED);
  assert.equal(observation?.title, "Add the Radius adapter");
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.recap, "The adapter is in place and the tests pass.");
  assert.equal(observation?.agent?.id, PROVIDER_ID.CLAUDE_CODE);
  assert.equal(observation?.detail?.model, "opus-5");
  assert.equal(observation?.detail?.repository, "luke");
  assert.equal(observation?.directory, LUKE_PROJECT_PATH);
  assert.equal(observation?.workspace?.providerWorkspaceId, LUKE_PROJECT_ID);
  assert.equal(observation?.workspace?.name, "luke");
  // A settled turn has moved past its tools, so nothing is running now.
  assert.equal(observation?.detail?.activity, undefined);
  // The row is led by the agent's mark, so the browser rides as the app —
  // without an address, because Radius registers no link that lands on a chat.
  assert.deepEqual(observation?.applications, [
    { id: "radius", displayName: "Radius", scope: "workspace" },
  ]);
  // A tray hides a workspace-scoped chip on its rows and names the manager
  // once on its own header, which it only draws with both of these — without
  // them two chats in one project lose every trace of Radius between them.
  assert.equal(observation?.workspace?.scopeId, PROVIDER_ID.RADIUS);
  assert.equal(observation?.workspace?.managerName, "Radius");
});

test("keeps a chat whose turn is still running however stale its own clock", async (t) => {
  const turnStartedMs = TEST_TIME - 6 * 60 * MINUTE_MS;
  const radiusHome = await radiusStore(t, (store) => {
    // Radius stamps a conversation at turn boundaries, so a chat six hours
    // into live work ranks below every chat touched since it began.
    store.chat({
      conversationId: CHAT_ID.WORKING,
      label: "A very long turn",
      updatedAt: turnStartedMs,
    });
    store.turn({
      conversationId: CHAT_ID.WORKING,
      status: "running",
      model: "claude-code/opus-5",
      createdAt: turnStartedMs,
    });
    for (let index = 0; index < 260; index += 1) {
      const conversationId = `chat:idle-${index}`;
      store.chat({
        conversationId,
        label: `Idle ${index}`,
        updatedAt: TEST_TIME - MINUTE_MS,
      });
      store.turn({
        conversationId,
        status: "completed",
        model: "claude-code/opus-5",
        createdAt: TEST_TIME - 2 * MINUTE_MS,
        completedAt: TEST_TIME - MINUTE_MS,
      });
    }
  });

  const observations = await adapterFor(radiusHome).observe();

  const running = observations.find((one) => one.providerSessionId === CHAT_ID.WORKING);
  assert.ok(running, "a chat with an unsettled turn is never cut by the cap");
  assert.equal(running?.status, SESSION_STATUS.UNKNOWN);
  // The settled chats past the cap are still dropped, so the bound holds.
  assert.equal(observations.length, 201);
});

test("reports the tool a running turn is holding on as its activity", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.WORKING,
      label: "Wire the mark",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.WORKING,
      status: "running",
      model: "codex/gpt-5.5",
      createdAt: TEST_TIME - MINUTE_MS,
      events: [
        message("assistant", "Looking at the generator now."),
        toolStarted("tool-1", "Read", { file_path: "/Users/test/luke/design/generate.mjs" }),
      ],
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, "Read: /Users/test/luke/design/generate.mjs");
  assert.equal(observation?.agent?.id, PROVIDER_ID.CODEX);
  assert.equal(observation?.detail?.model, "gpt-5.5");
  // A turn still running describes the turn before it, never where the chat
  // ended up, so its words are not a recap.
  assert.equal(observation?.recap, undefined);
});

test("a settled newest tool call means the turn moved past its tools", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.WORKING,
      label: "Thinking",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.WORKING,
      status: "running",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - MINUTE_MS,
      events: [toolStarted("tool-1", "Bash", { command: "ls" }), toolCompleted("tool-1", "Bash")],
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, undefined);
});

test("a turn the runtime recorded a failure for is an error carrying its words", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.FAILED,
      label: "Broken run",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.FAILED,
      status: "failed",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - 2 * MINUTE_MS,
      completedAt: TEST_TIME - MINUTE_MS,
      error: "The inference provider refused the request",
      events: [message("assistant", "Starting on it.")],
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "The inference provider refused the request");
  // A failed turn's trailing words describe work that did not land.
  assert.equal(observation?.recap, undefined);
});

test("a turn that ended any other way is settled without parting words", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.STOPPED,
      label: "Stopped run",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.STOPPED,
      status: "aborted",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - 2 * MINUTE_MS,
      completedAt: TEST_TIME - MINUTE_MS,
      events: [message("assistant", "I was partway through when")],
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  // The turn is over however it ended, so the chat is the developer's move —
  // but words cut mid-thought must never pose as an outcome.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.recap, undefined);
});

test("the developer's own message never becomes the recap", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.SETTLED,
      label: "Asked and answered",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.SETTLED,
      status: "completed",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - 2 * MINUTE_MS,
      completedAt: TEST_TIME - MINUTE_MS,
      events: [message("assistant", "Done."), message("user", "Now do the other thing")],
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.recap, "Done.");
});

test("draws no row for a chat the user filed away", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.ARCHIVED,
      label: "Filed away",
      updatedAt: TEST_TIME - MINUTE_MS,
      archived: true,
    });
    store.turn({
      conversationId: CHAT_ID.ARCHIVED,
      status: "completed",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - 2 * MINUTE_MS,
      completedAt: TEST_TIME - MINUTE_MS,
    });
  });

  assert.deepEqual(await adapterFor(radiusHome).observe(), []);
});

test("a chat that has never run a turn invents no live work", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.UNTOUCHED,
      label: "Opened, never asked",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.detail?.activity, undefined);
  assert.equal(observation?.detail?.model, undefined);
  assert.equal(observation?.agent, undefined);
});

test("a long turn still landing events stays working on its events' own clock", async (t) => {
  const turnStartedMs = TEST_TIME - 24 * 60 * MINUTE_MS;
  const radiusHome = await radiusStore(t, (store) => {
    // Radius stamps the conversation and the turn row at turn boundaries, so
    // both still carry the clock the turn started with a day ago.
    store.chat({
      conversationId: CHAT_ID.WORKING,
      label: "A very long turn",
      updatedAt: turnStartedMs,
    });
    store.turn({
      conversationId: CHAT_ID.WORKING,
      status: "running",
      model: "claude-code/opus-5",
      createdAt: turnStartedMs,
      events: [],
    });
  });
  // The turn's newest event landed a moment ago, which is the only record
  // that the work is still moving.
  const database = new DatabaseSync(path.join(radiusHome, "state", "agent-chat.sqlite"));
  database
    .prepare(`
      INSERT INTO events (turn_id, seq, event_id, kind, created_at, payload_json)
      VALUES ('turn-1', 1, 'turn-1:1', 'tool.started', ?, ?)
    `)
    .run(
      TEST_TIME - MINUTE_MS,
      JSON.stringify(toolStarted("tool-1", "Bash", { command: "pnpm test" })),
    );
  database.close();

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.observedAt, TEST_TIME - MINUTE_MS);
  assert.equal(observation?.detail?.activity, "Bash: pnpm test");
});

test("an open turn gone quiet decays rather than claiming live work", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.STALE,
      label: "Killed browser",
      updatedAt: TEST_TIME - 24 * 60 * MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.STALE,
      status: "running",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - 24 * 60 * MINUTE_MS,
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
});

test("names no agent for a model id outside the shape Radius writes", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.SETTLED,
      label: "Some other agent",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.SETTLED,
      status: "completed",
      model: "some-future-agent/m1",
      createdAt: TEST_TIME - 2 * MINUTE_MS,
      completedAt: TEST_TIME - MINUTE_MS,
    });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.agent, undefined);
  assert.equal(observation?.detail?.model, "some-future-agent/m1");
});

test("falls back to the workspace label for a chat Radius never named", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({ conversationId: CHAT_ID.SETTLED, label: "", updatedAt: TEST_TIME - MINUTE_MS });
  });

  const [observation] = await adapterFor(radiusHome).observe();

  assert.equal(observation?.title, "luke");
});

test("observes nothing where the browser has never run", async (t) => {
  const radiusHome = await temporaryRadiusHome(t);

  assert.deepEqual(await adapterFor(radiusHome).observe(), []);
  assert.equal(await adapterFor(radiusHome).readTranscript(CHAT_ID.SETTLED), undefined);
});

test("observes nothing from a store shaped differently than this build reads", async (t) => {
  const radiusHome = await radiusStore(
    t,
    () => {},
    "CREATE TABLE chat_conversations (conversation_id TEXT PRIMARY KEY);",
  );

  assert.deepEqual(await adapterFor(radiusHome).observe(), []);
});

test("reports the Radius provider itself", () => {
  assert.equal(RADIUS_PROVIDER.id, PROVIDER_ID.RADIUS);
  assert.equal(new RadiusSessionAdapter().provider, RADIUS_PROVIDER);
});

test("advertises no write, no control, and no address", async (t) => {
  const radiusHome = await radiusStore(t, (store) => {
    store.chat({
      conversationId: CHAT_ID.SETTLED,
      label: "Read only",
      updatedAt: TEST_TIME - MINUTE_MS,
    });
    store.turn({
      conversationId: CHAT_ID.SETTLED,
      status: "completed",
      model: "claude-code/opus-5",
      createdAt: TEST_TIME - 2 * MINUTE_MS,
      completedAt: TEST_TIME - MINUTE_MS,
    });
  });
  const adapter = adapterFor(radiusHome);

  const [observation] = await adapter.observe();

  assert.equal(observation?.controls, undefined);
  assert.equal(observation?.canReceiveMessage, undefined);
  assert.equal(observation?.canRename, undefined);
  // Radius registers no deep link that lands on a chat, so a row reports no
  // address and its press opens Luke's own panel.
  assert.equal(observation?.detail?.link, undefined);
  assert.equal(
    (await adapter.sendMessage({ providerSessionId: CHAT_ID.SETTLED, text: "hi" })).status,
    "unsupported",
  );
  assert.deepEqual(adapter.workspaceProjects(), []);
});
