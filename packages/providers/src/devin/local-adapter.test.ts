import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SESSION_COMPLETION_CAUSE, SESSION_STATUS } from "@sidecar/session";
import type { MutableWireRecord, ParsedJsonObject } from "@sidecar/wire/testing";
import { HOOK_NOTIFICATION_HOLD_HORIZON_MS } from "../shared/local-session-adapter.js";
import { DEVIN_PROVIDER } from "./adapter.js";
import { DevinLocalSessionAdapter } from "./local-adapter.js";

const TEST_TIME = Date.parse("2026-08-18T21:30:00.000Z");
const DEVIN_DATABASE = "sessions.db";
const TEST_SQLITE_ERROR = {
  UNKNOWN_BUILTIN_MODULE: "ERR_UNKNOWN_BUILTIN_MODULE",
} as const;
const TEST_DEVIN_ENVIRONMENT = {
  DATABASE_FILE: "CHISEL_SESSION_DB",
} as const;

/** Words that must never leave the records they are parsed from. */
const SECRET_TRANSCRIPT_TEXT = "SECRET_ROTATION_TOKEN_ABC123";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
/** The CLI stores every clock in seconds; the adapter must not read them as ms. */
function seconds(timeMs: number): number {
  return Math.floor(timeMs / 1000);
}

interface TestSession {
  id: string;
  workingDirectory: string;
  observedAt: number;
  title?: string;
  model?: string;
  mainChainId?: number;
  hidden?: boolean;
}

interface TestNode {
  sessionId: string;
  nodeId: number;
  parentNodeId?: number;
  time: number;
  message: ParsedJsonObject;
}

interface TestToolCall {
  sessionId: string;
  toolCallId: string;
  call?: ParsedJsonObject;
  update?: ParsedJsonObject;
}

function chatMessage(
  role: string,
  content: string,
  options: { messageId?: string; toolCalls?: readonly ParsedJsonObject[] } = {},
): ParsedJsonObject {
  const payload: MutableWireRecord = {
    message_id: options.messageId ?? `msg-${role}-${content.length}`,
    role,
    content,
    metadata: { is_user_input: role === "user" ? true : null, finish_reason: null },
  };
  if (options.toolCalls) {
    payload.tool_calls = options.toolCalls;
  }
  return payload;
}

async function temporaryCliDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-devin-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function writeSession(database: DatabaseSync, session: TestSession): void {
  database
    .prepare(`
      INSERT INTO sessions (
        id,
        working_directory,
        backend_type,
        model,
        agent_mode,
        created_at,
        last_activity_at,
        title,
        main_chain_id,
        shell_last_seen_index,
        cogs_json,
        workspace_dirs,
        hidden,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      session.id,
      session.workingDirectory,
      "windsurf",
      session.model ?? "",
      "accept-edits",
      seconds(session.observedAt),
      seconds(session.observedAt),
      session.title ?? null,
      session.mainChainId ?? null,
      0,
      null,
      "[]",
      session.hidden ? 1 : 0,
      null,
    );
}

function writeNode(database: DatabaseSync, node: TestNode): void {
  database
    .prepare(`
      INSERT INTO message_nodes (session_id, node_id, parent_node_id, chat_message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      node.sessionId,
      node.nodeId,
      node.parentNodeId ?? null,
      JSON.stringify(node.message),
      seconds(node.time),
    );
}

function writeToolCall(database: DatabaseSync, toolCall: TestToolCall): void {
  database
    .prepare(`
      INSERT INTO tool_call_state (session_id, tool_call_id, tool_call_json, tool_call_update_json)
      VALUES (?, ?, ?, ?)
    `)
    .run(
      toolCall.sessionId,
      toolCall.toolCallId,
      toolCall.call ? JSON.stringify(toolCall.call) : null,
      toolCall.update ? JSON.stringify(toolCall.update) : null,
    );
}

async function writeDevinState(
  cliDirectory: string,
  sessions: readonly TestSession[],
  options: {
    databaseFile?: string;
    nodes?: readonly TestNode[];
    toolCalls?: readonly TestToolCall[];
  } = {},
): Promise<void> {
  await fs.mkdir(cliDirectory, { recursive: true });
  const database = new DatabaseSync(
    path.join(cliDirectory, options.databaseFile ?? DEVIN_DATABASE),
    {},
  );
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
        shell_last_seen_index INTEGER DEFAULT 0,
        cogs_json TEXT,
        workspace_dirs TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        metadata TEXT
      );
      CREATE TABLE message_nodes (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        node_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        chat_message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        metadata TEXT,
        UNIQUE(session_id, node_id)
      );
      CREATE TABLE tool_call_state (
        session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_call_json TEXT,
        tool_call_update_json TEXT,
        PRIMARY KEY (session_id, tool_call_id)
      );
    `);
    for (const session of sessions) writeSession(database, session);
    for (const node of options.nodes ?? []) writeNode(database, node);
    for (const toolCall of options.toolCalls ?? []) writeToolCall(database, toolCall);
  } finally {
    database.close();
  }
}

async function writeMalformedDevinState(cliDirectory: string): Promise<void> {
  await fs.mkdir(cliDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(cliDirectory, DEVIN_DATABASE), {});
  try {
    database.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  } finally {
    database.close();
  }
}

/** A database from before the title, chain-tip, and hidden migrations. */
async function writeEarlyDevinState(
  cliDirectory: string,
  sessions: readonly { id: string; workingDirectory: string; observedAt: number }[],
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
        last_activity_at INTEGER NOT NULL
      )
    `);
    for (const session of sessions) {
      database
        .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          session.id,
          session.workingDirectory,
          "windsurf",
          "",
          "auto",
          seconds(session.observedAt),
          seconds(session.observedAt),
        );
    }
  } finally {
    database.close();
  }
}

test("observes a Devin session under the name Devin gave it", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinState(
    cliDirectory,
    [
      {
        id: "leaf-flax",
        workingDirectory: "/Users/test/luke",
        observedAt: TEST_TIME - 60_000,
        title: "Wire the notch geometry to the housing",
        model: "swe-1-6-fast",
        mainChainId: 3,
      },
    ],
    {
      nodes: [
        {
          sessionId: "leaf-flax",
          nodeId: 0,
          time: TEST_TIME - 60_000,
          message: chatMessage("system", `Prompt holding ${SECRET_TRANSCRIPT_TEXT}`),
        },
        {
          sessionId: "leaf-flax",
          nodeId: 1,
          parentNodeId: 0,
          time: TEST_TIME - 60_000,
          message: chatMessage("user", "Wire the notch geometry to the housing"),
        },
        {
          sessionId: "leaf-flax",
          nodeId: 2,
          parentNodeId: 1,
          time: TEST_TIME - 60_000,
          message: chatMessage("system", "<available_skills>plumbing</available_skills>"),
        },
        {
          sessionId: "leaf-flax",
          nodeId: 3,
          parentNodeId: 2,
          time: TEST_TIME - 60_000,
          message: chatMessage("system", "<system_info>workspace context</system_info>"),
        },
      ],
    },
  );

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, DEVIN_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "leaf-flax");
  assert.equal(observations[0]?.title, "Wire the notch geometry to the housing");
  // The tip walks past the interleaved system context to the developer's own
  // prompt, which is a turn Devin still owes an answer to.
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  // The database stores seconds; the observation must report milliseconds.
  assert.equal(observations[0]?.observedAt, TEST_TIME - 60_000);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    model: "swe-1-6-fast",
  });
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("falls back to the workspace while Devin has not named the session", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinState(cliDirectory, [
    {
      id: "brisk-otter",
      workingDirectory: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "luke");
  // A session with no messages yet has just been started.
  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a settled Devin turn as waiting for its developer", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinState(
    cliDirectory,
    [
      {
        id: "calm-harbor",
        workingDirectory: "/Users/test/luke",
        observedAt: TEST_TIME - 60_000,
        title: "Explain the panel motion",
        mainChainId: 2,
      },
    ],
    {
      nodes: [
        {
          sessionId: "calm-harbor",
          nodeId: 0,
          time: TEST_TIME - 120_000,
          message: chatMessage("user", "Explain the panel motion"),
        },
        {
          sessionId: "calm-harbor",
          nodeId: 1,
          parentNodeId: 0,
          time: TEST_TIME - 60_000,
          message: chatMessage("assistant", `The spring ${SECRET_TRANSCRIPT_TEXT}`),
        },
        {
          sessionId: "calm-harbor",
          nodeId: 2,
          parentNodeId: 1,
          time: TEST_TIME - 60_000,
          message: chatMessage("system", "<system_info>context refresh</system_info>"),
        },
      ],
    },
  );

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.ok(!JSON.stringify(await adapter.observe()).includes(SECRET_TRANSCRIPT_TEXT));
});

test("ages a settled turn nobody has come back to into unknown", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const staleTime = TEST_TIME - 16 * 60_000;
  await writeDevinState(
    cliDirectory,
    [
      {
        id: "quiet-brook",
        workingDirectory: "/Users/test/luke",
        observedAt: staleTime,
        mainChainId: 1,
      },
    ],
    {
      nodes: [
        {
          sessionId: "quiet-brook",
          nodeId: 0,
          time: staleTime,
          message: chatMessage("user", "hello"),
        },
        {
          sessionId: "quiet-brook",
          nodeId: 1,
          parentNodeId: 0,
          time: staleTime,
          message: chatMessage("assistant", "Hi!"),
        },
      ],
    },
  );

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
});

test("ages an open turn a killed process left behind into unknown", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const staleTime = TEST_TIME - 16 * 60_000;
  await writeDevinState(
    cliDirectory,
    [
      {
        id: "left-behind",
        workingDirectory: "/Users/test/luke",
        observedAt: staleTime,
        mainChainId: 0,
      },
    ],
    {
      nodes: [
        {
          sessionId: "left-behind",
          nodeId: 0,
          time: staleTime,
          message: chatMessage("user", "run the suite"),
        },
      ],
    },
  );

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
});

test("names the open tool call a working session is running", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinState(
    cliDirectory,
    [
      {
        id: "swift-gorge",
        workingDirectory: "/Users/test/luke",
        observedAt: TEST_TIME - 1_000,
        title: "Run the checks",
        mainChainId: 1,
      },
    ],
    {
      nodes: [
        {
          sessionId: "swift-gorge",
          nodeId: 0,
          time: TEST_TIME - 2_000,
          message: chatMessage("user", "Run the checks"),
        },
        {
          sessionId: "swift-gorge",
          nodeId: 1,
          parentNodeId: 0,
          time: TEST_TIME - 1_000,
          message: chatMessage("assistant", "Running them now.", {
            toolCalls: [{ id: "call-1", name: "exec" }],
          }),
        },
      ],
      toolCalls: [
        {
          sessionId: "swift-gorge",
          toolCallId: "call-0",
          call: {
            toolCallId: "call-0",
            title: "Read package.json",
            kind: "read",
            status: "completed",
            content: [{ type: "content", content: SECRET_TRANSCRIPT_TEXT }],
          },
          update: { toolCallId: "call-0", status: "completed" },
        },
        {
          sessionId: "swift-gorge",
          toolCallId: "call-1",
          call: {
            toolCallId: "call-1",
            title: "Run ./scripts/check.sh",
            kind: "execute",
            status: "in_progress",
            rawInput: { command: `./scripts/check.sh ${SECRET_TRANSCRIPT_TEXT}` },
          },
        },
        // Newer than the running call, but an interrupted session left it
        // settled without its update — passed over rather than reported.
        {
          sessionId: "swift-gorge",
          toolCallId: "call-2",
          call: {
            toolCallId: "call-2",
            title: "Read the interrupted file",
            kind: "read",
            status: "completed",
          },
        },
      ],
    },
  );

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, "Run ./scripts/check.sh");
  assert.ok(!JSON.stringify(await adapter.observe()).includes(SECRET_TRANSCRIPT_TEXT));
});

test("follows the main chain rather than a rewound session's abandoned branch", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinState(
    cliDirectory,
    [
      {
        id: "second-try",
        workingDirectory: "/Users/test/luke",
        observedAt: TEST_TIME - 1_000,
        title: "Try again",
        mainChainId: 2,
      },
    ],
    {
      nodes: [
        {
          sessionId: "second-try",
          nodeId: 0,
          time: TEST_TIME - 4_000,
          message: chatMessage("user", "First attempt"),
        },
        // The abandoned branch: an answer the developer rewound away from. It
        // holds the newest node id, so top-of-table reading would call this
        // session settled.
        {
          sessionId: "second-try",
          nodeId: 3,
          parentNodeId: 0,
          time: TEST_TIME - 3_000,
          message: chatMessage("assistant", "A settled answer"),
        },
        {
          sessionId: "second-try",
          nodeId: 2,
          parentNodeId: 0,
          time: TEST_TIME - 1_000,
          message: chatMessage("user", "Second attempt"),
        },
      ],
    },
  );

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("leaves hidden sessions off the roster", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinState(cliDirectory, [
    {
      id: "shown-session",
      workingDirectory: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
    },
    {
      id: "hidden-session",
      workingDirectory: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
      hidden: true,
    },
  ]);

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["shown-session"],
  );
});

test("reads a database from before the title and hidden migrations", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeEarlyDevinState(cliDirectory, [
    {
      id: "early-install",
      workingDirectory: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.providerSessionId, "early-install");
  assert.equal(observation?.title, "luke");
});

test("observes nothing where the Devin CLI has never run", async (t) => {
  const cliDirectory = path.join(await temporaryCliDirectory(t), "missing");
  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  assert.deepEqual(await adapter.observe(), []);
});

test("observes nothing from a database this build cannot read", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeMalformedDevinState(cliDirectory);
  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  assert.deepEqual(await adapter.observe(), []);
});

test("observes nothing where the runtime has no sqlite module", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeDevinState(cliDirectory, [
    { id: "unreadable", workingDirectory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 },
  ]);

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    now: () => TEST_TIME,
    sqlite: async () => {
      const error: NodeJS.ErrnoException = new Error("No such built-in module: node:sqlite");
      error.code = TEST_SQLITE_ERROR.UNKNOWN_BUILTIN_MODULE;
      throw error;
    },
  });
  assert.deepEqual(await adapter.observe(), []);
});

// ---------------------------------------------------------------------------
// Hook-event refinement. Every test here layers a spool the observation hook
// would have written over the session database, because that is the
// arrangement in production: the rows and chains are always read, and the
// event only sharpens them.
// ---------------------------------------------------------------------------

async function temporaryHookSpool(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-devin-spool-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeHookEvent(
  spoolDirectory: string,
  providerSessionId: string,
  event: string,
  mtimeMs: number,
): Promise<void> {
  const filePath = path.join(spoolDirectory, `${providerSessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify({ event }));
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

/** A session mid-turn by every record: the developer's prompt is the tip. */
async function writeOpenTurnState(
  cliDirectory: string,
  sessionId: string,
  observedAt: number,
): Promise<void> {
  await writeDevinState(
    cliDirectory,
    [{ id: sessionId, workingDirectory: "/Users/test/luke", observedAt, mainChainId: 0 }],
    {
      nodes: [
        { sessionId, nodeId: 0, time: observedAt, message: chatMessage("user", "run the suite") },
      ],
    },
  );
}

/** A session whose turn settled: the assistant's reply is the tip. */
async function writeSettledTurnState(
  cliDirectory: string,
  sessionId: string,
  observedAt: number,
): Promise<void> {
  await writeDevinState(
    cliDirectory,
    [{ id: sessionId, workingDirectory: "/Users/test/luke", observedAt, mainChainId: 1 }],
    {
      nodes: [
        { sessionId, nodeId: 0, time: observedAt, message: chatMessage("user", "hello") },
        {
          sessionId,
          nodeId: 1,
          parentNodeId: 0,
          time: observedAt,
          message: chatMessage("assistant", "Hi!"),
        },
      ],
    },
  );
}

test("a permission request the database cannot show turns the row to waiting", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  // Mid-turn by every record: a call holding for approval writes no node
  // further, so without the event this session reads as working.
  await writeOpenTurnState(cliDirectory, "held-call", TEST_TIME - 5 * 60_000);
  await writeHookEvent(spool, "held-call", "notification", TEST_TIME - 60_000);

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
  // The event also dates the session: the spool is written only by Luke's own
  // script, so its clock is the moment the session actually moved.
  assert.equal(observation?.observedAt, TEST_TIME - 60_000);
});

test("a session-end event settles a row the database would leave waiting", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  await writeSettledTurnState(cliDirectory, "closed-out", TEST_TIME - 5 * 60_000);
  await writeHookEvent(spool, "closed-out", "session-end", TEST_TIME - 60_000);

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.COMPLETE);
  assert.equal(observation?.completionCause, SESSION_COMPLETION_CAUSE.SESSION_CLOSED);
});

test("a stop event keeps a finished turn waiting past the freshness decay", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  // Twenty minutes past the row's clock, the database alone decays to unknown.
  await writeSettledTurnState(cliDirectory, "still-waiting", TEST_TIME - 20 * 60_000);
  await writeHookEvent(spool, "still-waiting", "stop", TEST_TIME - 60_000);

  const adapter = new DevinLocalSessionAdapter({
    activeSessionFreshnessMs: 15 * 60_000,
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("an event the session has moved past refines nothing", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  await writeOpenTurnState(cliDirectory, "moved-on", TEST_TIME - 60_000);
  // A stop from a minute before the row's clock: hooks were off, or the write
  // raced. The session is demonstrably mid-turn again.
  await writeHookEvent(spool, "moved-on", "stop", TEST_TIME - 2 * 60_000);

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.observedAt, TEST_TIME - 60_000);
});

test("a prompt event reads a fresh turn as working before the node shows it", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  await writeSettledTurnState(cliDirectory, "prompted", TEST_TIME - 60_000);
  await writeHookEvent(spool, "prompted", "prompt", TEST_TIME - 5_000);

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a notification the session has answered stands down at once", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  // The approval was granted and the call ran: a row touched after the
  // notification, though within the tolerance the other events enjoy.
  await writeOpenTurnState(cliDirectory, "approved", TEST_TIME - 1_000);
  await writeHookEvent(spool, "approved", "notification", TEST_TIME - 3_000);

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a spool that cannot be read costs only the refinement", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  await writeOpenTurnState(cliDirectory, "unrefined", TEST_TIME - 1_000);

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    hookEventsDirectory: () => path.join(cliDirectory, "no-such-spool"),
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a permission hold that outlives the freshness window is still an ask", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  // A standing notification is proof the approval dialog is still up — the
  // hold writes no rows, so any row at or past it would have discarded it —
  // and an ask still asking must neither flip back to active work nor melt
  // into an idle row however long it has stood.
  await writeOpenTurnState(cliDirectory, "long-hold", TEST_TIME - 30 * 60_000);
  await writeHookEvent(spool, "long-hold", "notification", TEST_TIME - 20 * 60_000);

  const adapter = new DevinLocalSessionAdapter({
    activeSessionFreshnessMs: 15 * 60_000,
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("a permission hold past the hold horizon stands down on its own", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const spool = await temporaryHookSpool(t);
  // A process killed mid-hold writes neither the approval nor a closing
  // hook. Past the horizon the standing event refines nothing, and the open
  // turn decays to unknown exactly as it would with no event at all.
  await writeOpenTurnState(
    cliDirectory,
    "dead-hold",
    TEST_TIME - HOOK_NOTIFICATION_HOLD_HORIZON_MS - 60 * 60_000,
  );
  await writeHookEvent(
    spool,
    "dead-hold",
    "notification",
    TEST_TIME - HOOK_NOTIFICATION_HOLD_HORIZON_MS - 60_000,
  );

  const adapter = new DevinLocalSessionAdapter({
    cliDirectory,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observation?.holdingForDeveloper, undefined);
});

test("honors the CLI's own database override", async (t) => {
  const cliDirectory = await temporaryCliDirectory(t);
  const relocatedDirectory = await temporaryCliDirectory(t);
  await writeDevinState(relocatedDirectory, [
    {
      id: "relocated",
      workingDirectory: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const previous = process.env[TEST_DEVIN_ENVIRONMENT.DATABASE_FILE];
  process.env[TEST_DEVIN_ENVIRONMENT.DATABASE_FILE] = path.join(relocatedDirectory, DEVIN_DATABASE);
  t.after(() => {
    if (previous === undefined) {
      delete process.env[TEST_DEVIN_ENVIRONMENT.DATABASE_FILE];
    } else {
      process.env[TEST_DEVIN_ENVIRONMENT.DATABASE_FILE] = previous;
    }
  });

  const adapter = new DevinLocalSessionAdapter({ cliDirectory, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.providerSessionId, "relocated");
});
