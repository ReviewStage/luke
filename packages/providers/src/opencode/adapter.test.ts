import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SESSION_COMPLETION_CAUSE, SESSION_STATUS } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { HOOK_NOTIFICATION_HOLD_HORIZON_MS } from "../shared/local-session-adapter.js";
import { OPENCODE_PROVIDER, OpenCodeSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-13T21:30:00.000Z");
const OPENCODE_DATABASE = "opencode.db";
const OPENCODE_PROD_DATABASE = "opencode-prod.db";
const TEST_SQLITE_ERROR = {
  UNKNOWN_BUILTIN_MODULE: "ERR_UNKNOWN_BUILTIN_MODULE",
} as const;
const TEST_OPENCODE_ENVIRONMENT = {
  DATABASE_FILE: "OPENCODE_DB",
} as const;

interface TestSession {
  id: string;
  directory: string;
  observedAt: number;
  title?: string;
  parentId?: string;
  archivedAt?: number;
  model?: string;
  shareUrl?: string;
}

interface TestMessage {
  id: string;
  sessionId: string;
  time: number;
  data: ParsedJsonObject;
}

interface TestPart {
  id: string;
  messageId: string;
  sessionId: string;
  time: number;
  data: ParsedJsonObject;
}

async function temporaryDataDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-opencode-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function writeSession(database: DatabaseSync, session: TestSession): void {
  database
    .prepare(`
      INSERT INTO session (
        id,
        project_id,
        parent_id,
        slug,
        directory,
        title,
        version,
        share_url,
        model,
        cost,
        time_created,
        time_updated,
        time_archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      session.id,
      "63bb8c77541efac08dcca1c5bbb14be27bc48476",
      session.parentId ?? null,
      "clever-panda",
      session.directory,
      session.title ?? "New session - 2026-08-13T21:16:44.104Z",
      "1.18.18",
      session.shareUrl ?? null,
      session.model ?? null,
      0,
      session.observedAt,
      session.observedAt,
      session.archivedAt ?? null,
    );
}

function writeMessage(database: DatabaseSync, message: TestMessage): void {
  database
    .prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(message.id, message.sessionId, message.time, message.time, JSON.stringify(message.data));
}

function writePart(database: DatabaseSync, part: TestPart): void {
  database
    .prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(part.id, part.messageId, part.sessionId, part.time, part.time, JSON.stringify(part.data));
}

async function writeOpenCodeState(
  dataDirectory: string,
  sessions: readonly TestSession[],
  options: {
    databaseFile?: string;
    messages?: readonly TestMessage[];
    parts?: readonly TestPart[];
  } = {},
): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const database = new DatabaseSync(
    path.join(dataDirectory, options.databaseFile ?? OPENCODE_DATABASE),
    {},
  );
  try {
    database.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_id TEXT,
        slug TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        version TEXT NOT NULL,
        share_url TEXT,
        model TEXT,
        cost REAL DEFAULT 0 NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        time_archived INTEGER
      );
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
    for (const session of sessions) writeSession(database, session);
    for (const message of options.messages ?? []) writeMessage(database, message);
    for (const part of options.parts ?? []) writePart(database, part);
  } finally {
    database.close();
  }
}

async function writeMalformedOpenCodeState(
  dataDirectory: string,
  databaseFile: string,
): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(dataDirectory, databaseFile), {});
  try {
    database.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  } finally {
    database.close();
  }
}

/** A database from before the subagent and archive columns existed. */
async function writeEarlyOpenCodeState(
  dataDirectory: string,
  sessions: readonly { id: string; directory: string; observedAt: number; title: string }[],
): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(dataDirectory, OPENCODE_DATABASE), {});
  try {
    database.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      )
    `);
    for (const session of sessions) {
      database
        .prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)")
        .run(
          session.id,
          "project-early",
          session.directory,
          session.title,
          session.observedAt,
          session.observedAt,
        );
    }
  } finally {
    database.close();
  }
}

async function writeLegacySession(
  dataDirectory: string,
  projectId: string,
  info: ParsedJsonObject & { id: string },
): Promise<void> {
  const sessionDirectory = path.join(dataDirectory, "storage", "session", projectId);
  await fs.mkdir(sessionDirectory, { recursive: true });
  await fs.writeFile(path.join(sessionDirectory, `${info.id}.json`), JSON.stringify(info));
}

async function writeLegacyMessage(
  dataDirectory: string,
  sessionId: string,
  messageId: string,
  record: ParsedJsonObject,
): Promise<void> {
  const messageDirectory = path.join(dataDirectory, "storage", "message", sessionId);
  await fs.mkdir(messageDirectory, { recursive: true });
  await fs.writeFile(path.join(messageDirectory, `${messageId}.json`), JSON.stringify(record));
}

test("observes an OpenCode session under the name OpenCode gave it", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [
      {
        id: "ses_active",
        directory: "/Users/test/luke",
        observedAt: TEST_TIME - 1_000,
        title: "Wire the notch geometry to the housing",
        model: JSON.stringify({ providerID: "anthropic", id: "claude-sonnet-5", variant: "high" }),
        shareUrl: "https://opencode.ai/s/AbCdEf",
      },
    ],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_active",
          time: TEST_TIME - 1_000,
          data: { role: "assistant", time: { created: TEST_TIME - 1_000 } },
        },
      ],
    },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, OPENCODE_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "ses_active");
  assert.equal(observations[0]?.title, "Wire the notch geometry to the housing");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.controls, undefined);
  // The raw directory rides for workspace managers to match by; the bounded
  // repository label below is what a surface draws.
  assert.equal(observations[0]?.directory, "/Users/test/luke");
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    model: "claude-sonnet-5 · high",
    link: "https://opencode.ai/s/AbCdEf",
  });
});

test("falls back to the workspace while OpenCode has not named the session", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(dataDirectory, [
    {
      id: "ses_unnamed",
      directory: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
      title: "New session - 2026-08-13T21:16:44.104Z",
    },
  ]);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "luke");
  // A session with no messages yet has just been started.
  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a finished OpenCode turn as waiting for its developer", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_done", directory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 }],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_done",
          time: TEST_TIME - 1_000,
          data: {
            role: "assistant",
            time: { created: TEST_TIME - 2_000, completed: TEST_TIME - 1_000 },
          },
        },
      ],
      parts: [
        {
          id: "prt_01",
          messageId: "msg_01",
          sessionId: "ses_done",
          time: TEST_TIME - 1_500,
          data: {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "pnpm test" } },
          },
        },
      ],
    },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.detail?.activity, undefined);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a stopped OpenCode turn as waiting when its user aborted it", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_aborted", directory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 }],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_aborted",
          time: TEST_TIME - 1_000,
          data: {
            role: "assistant",
            time: { created: TEST_TIME - 2_000 },
            error: { name: "MessageAbortedError", data: {} },
          },
        },
      ],
    },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.detail?.error, undefined);
});

test("reports a failed OpenCode turn with the failure it recorded", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [
      {
        id: "ses_failed",
        directory: "/Users/test/luke",
        // A failure outlives freshness: it does not heal by going stale.
        observedAt: TEST_TIME - 20 * 60 * 1000,
      },
    ],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_failed",
          time: TEST_TIME - 20 * 60 * 1000,
          data: {
            role: "assistant",
            time: { created: TEST_TIME - 20 * 60 * 1000 },
            error: { name: "ProviderAuthError", data: { message: "API key is invalid" } },
          },
        },
      ],
    },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "API key is invalid");
});

test("names the tool an OpenCode session is running", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_running", directory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 }],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_running",
          time: TEST_TIME - 1_000,
          data: { role: "assistant", time: { created: TEST_TIME - 1_000 } },
        },
      ],
      parts: [
        {
          id: "prt_01",
          messageId: "msg_01",
          sessionId: "ses_running",
          time: TEST_TIME - 2_000,
          data: { type: "step-start" },
        },
        {
          id: "prt_02",
          messageId: "msg_01",
          sessionId: "ses_running",
          time: TEST_TIME - 1_000,
          data: {
            type: "tool",
            tool: "bash",
            state: {
              status: "running",
              input: { command: "pnpm test" },
              time: { start: TEST_TIME },
            },
          },
        },
      ],
    },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, "bash: pnpm test");
});

test("names the tool still running behind one that already settled", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_parallel", directory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 }],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_parallel",
          time: TEST_TIME - 1_000,
          data: { role: "assistant", time: { created: TEST_TIME - 3_000 } },
        },
      ],
      parts: [
        {
          id: "prt_01",
          messageId: "msg_01",
          sessionId: "ses_parallel",
          time: TEST_TIME - 3_000,
          data: {
            type: "tool",
            tool: "bash",
            state: { status: "running", input: { command: "pnpm test" } },
          },
        },
        // OpenCode runs tools concurrently, so a newer call can settle while
        // an older one is still the work the session is doing.
        {
          id: "prt_02",
          messageId: "msg_01",
          sessionId: "ses_parallel",
          time: TEST_TIME - 1_000,
          data: {
            type: "tool",
            tool: "read",
            state: { status: "completed", input: { filePath: "README.md" } },
          },
        },
      ],
    },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, "bash: pnpm test");
});

test("skips OpenCode subagent and archived sessions", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(dataDirectory, [
    {
      id: "ses_parent",
      directory: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
      title: "Ship the release notes",
    },
    {
      id: "ses_child",
      directory: "/Users/test/luke",
      observedAt: TEST_TIME - 500,
      parentId: "ses_parent",
    },
    {
      id: "ses_archived",
      directory: "/Users/test/archived",
      observedAt: TEST_TIME - 1_000,
      archivedAt: TEST_TIME - 800,
    },
  ]);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["ses_parent"],
  );
});

test("reads every session's turn rather than a capped few", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  // More sessions than any per-pass read cap could hide behind: every one of
  // them has finished its turn, so a session left unread would show as
  // working on freshness alone.
  const sessions = Array.from({ length: 15 }, (_, index) => ({
    id: `ses_many_${String(index).padStart(2, "0")}`,
    directory: `/Users/test/project-${index}`,
    observedAt: TEST_TIME - 1_000 - index,
  }));
  await writeOpenCodeState(dataDirectory, sessions, {
    messages: sessions.map((session, index) => ({
      id: `msg_${String(index).padStart(2, "0")}`,
      sessionId: session.id,
      time: session.observedAt,
      data: {
        role: "assistant",
        time: { created: session.observedAt - 1_000, completed: session.observedAt },
      },
    })),
  });

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 15);
  for (const observation of observations) {
    assert.equal(observation.status, SESSION_STATUS.WAITING, observation.providerSessionId);
  }
});

test("keeps old OpenCode sessions beside the newest", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(dataDirectory, [
    { id: "ses_old", directory: "/Users/test/old", observedAt: TEST_TIME - 90_000 },
    { id: "ses_new", directory: "/Users/test/new", observedAt: TEST_TIME - 10_000 },
  ]);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => ({
      providerSessionId: observation.providerSessionId,
      title: observation.title,
    })),
    [
      { providerSessionId: "ses_new", title: "new" },
      { providerSessionId: "ses_old", title: "old" },
    ],
  );
});

test("keeps stale open OpenCode turns unknown instead of inventing activity", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_stale", directory: "/Users/test/stale", observedAt: TEST_TIME - 20 * 60 * 1000 }],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_stale",
          time: TEST_TIME - 20 * 60 * 1000,
          // An open turn: a killed OpenCode process leaves one on disk forever.
          data: { role: "assistant", time: { created: TEST_TIME - 20 * 60 * 1000 } },
        },
      ],
    },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observation?.detail?.activity, undefined);
});

test("observes the database OPENCODE_DB names", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const previousDatabaseFile = process.env[TEST_OPENCODE_ENVIRONMENT.DATABASE_FILE];
  process.env[TEST_OPENCODE_ENVIRONMENT.DATABASE_FILE] = "configured.db";
  t.after(() => {
    if (previousDatabaseFile === undefined) {
      delete process.env[TEST_OPENCODE_ENVIRONMENT.DATABASE_FILE];
    } else {
      process.env[TEST_OPENCODE_ENVIRONMENT.DATABASE_FILE] = previousDatabaseFile;
    }
  });
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_configured", directory: "/Users/test/configured", observedAt: TEST_TIME - 1_000 }],
    { databaseFile: "configured.db" },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "ses_configured");
});

test("falls back to the prod-channel database when the current one is unusable", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeMalformedOpenCodeState(dataDirectory, OPENCODE_DATABASE);
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_prod", directory: "/Users/test/prod", observedAt: TEST_TIME - 1_000 }],
    { databaseFile: OPENCODE_PROD_DATABASE },
  );

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "ses_prod");
  assert.equal(observations[0]?.title, "prod");
});

test("observes sessions from a database predating the archive column", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeEarlyOpenCodeState(dataDirectory, [
    {
      id: "ses_early",
      directory: "/Users/test/early",
      observedAt: TEST_TIME - 1_000,
      title: "Rename the settings key",
    },
  ]);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "ses_early");
  assert.equal(observations[0]?.title, "Rename the settings key");
});

test("observes legacy JSON sessions when no database exists", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeLegacySession(dataDirectory, "project-one", {
    id: "ses_legacy",
    title: "Migrate the settings store",
    directory: "/Users/test/luke",
    version: "1.1.0",
    time: { created: TEST_TIME - 5_000, updated: TEST_TIME - 1_000 },
  });
  await writeLegacySession(dataDirectory, "project-one", {
    id: "ses_legacy_child",
    title: "Subagent",
    directory: "/Users/test/luke",
    parentID: "ses_legacy",
    time: { created: TEST_TIME - 5_000, updated: TEST_TIME - 1_000 },
  });
  await writeLegacyMessage(dataDirectory, "ses_legacy", "msg_01", {
    id: "msg_01",
    sessionID: "ses_legacy",
    role: "assistant",
    time: { created: TEST_TIME - 2_000, completed: TEST_TIME - 1_000 },
  });

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "ses_legacy");
  assert.equal(observations[0]?.title, "Migrate the settings store");
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.directory, "/Users/test/luke");
  assert.deepEqual(observations[0]?.detail, { repository: "luke" });
});

test("reads the newest legacy message by its ordered identifier", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeLegacySession(dataDirectory, "project-one", {
    id: "ses_legacy_open",
    title: "Long refactor",
    directory: "/Users/test/luke",
    time: { created: TEST_TIME - 5_000, updated: TEST_TIME - 1_000 },
  });
  await writeLegacyMessage(dataDirectory, "ses_legacy_open", "msg_01", {
    role: "assistant",
    time: { created: TEST_TIME - 4_000, completed: TEST_TIME - 3_000 },
  });
  await writeLegacyMessage(dataDirectory, "ses_legacy_open", "msg_02", {
    role: "assistant",
    time: { created: TEST_TIME - 2_000 },
  });

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("re-reads a legacy session once a newer message lands", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeLegacySession(dataDirectory, "project-one", {
    id: "ses_legacy_evolving",
    title: "Long refactor",
    directory: "/Users/test/luke",
    time: { created: TEST_TIME - 5_000, updated: TEST_TIME - 1_000 },
  });
  await writeLegacyMessage(dataDirectory, "ses_legacy_evolving", "msg_01", {
    role: "assistant",
    time: { created: TEST_TIME - 4_000 },
  });

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });
  const [before] = await adapter.observe();
  await writeLegacyMessage(dataDirectory, "ses_legacy_evolving", "msg_02", {
    role: "assistant",
    time: { created: TEST_TIME - 2_000, completed: TEST_TIME - 1_000 },
  });
  const [after] = await adapter.observe();

  // The same adapter serves both passes, so the second one must find the new
  // message rather than serving the first turn back.
  assert.equal(before?.status, SESSION_STATUS.WORKING);
  assert.equal(after?.status, SESSION_STATUS.WAITING);
});

test("observes legacy JSON sessions when node sqlite is unavailable", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOpenCodeState(dataDirectory, [
    { id: "ses_unreachable", directory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 },
  ]);
  await writeLegacySession(dataDirectory, "project-one", {
    id: "ses_legacy",
    title: "Still observable",
    directory: "/Users/test/luke",
    time: { created: TEST_TIME - 5_000, updated: TEST_TIME - 1_000 },
  });
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const error = new Error("No such built-in module: node:sqlite") as NodeJS.ErrnoException;
  error.code = TEST_SQLITE_ERROR.UNKNOWN_BUILTIN_MODULE;

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    sqlite: async () => {
      throw error;
    },
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "ses_legacy");
});

test("returns an empty snapshot when OpenCode has no local state", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
  });

  assert.deepEqual(await adapter.observe(), []);
});

async function writeHookEvent(
  spoolDirectory: string,
  sessionId: string,
  token: string,
  atMs: number,
): Promise<void> {
  await fs.mkdir(spoolDirectory, { recursive: true });
  const filePath = path.join(spoolDirectory, `${sessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify({ event: token }));
  await fs.utimes(filePath, atMs / 1000, atMs / 1000);
}

/** A session whose open turn the database alone would read as working. */
async function writeWorkingSession(dataDirectory: string, sessionId: string): Promise<void> {
  await writeOpenCodeState(
    dataDirectory,
    [{ id: sessionId, directory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 }],
    {
      messages: [
        {
          id: "msg_01",
          sessionId,
          time: TEST_TIME - 1_000,
          data: { role: "assistant", time: { created: TEST_TIME - 1_000 } },
        },
      ],
    },
  );
}

test("a fresh permission ask reads as holding for the developer", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeWorkingSession(dataDirectory, "ses_holding");
  await writeHookEvent(spoolDirectory, "ses_holding", "notification", TEST_TIME);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  // The database shows an open turn — a permission holds without writing a
  // record — so only the plugin's event can say the session is waiting on
  // its developer.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
  assert.equal(observation?.observedAt, TEST_TIME);
});

test("a permission hold that outlives the freshness window is still an ask", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeWorkingSession(dataDirectory, "ses_long_hold");
  await writeHookEvent(spoolDirectory, "ses_long_hold", "notification", TEST_TIME);

  // A standing notification is proof the ask is still up — the hold writes
  // no record, so any record at or past it would have discarded it — and an
  // ask still asking must not melt into an idle row however long it stands.
  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME + 20 * 60_000,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
});

test("a permission hold past the hold horizon stands down on its own", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeWorkingSession(dataDirectory, "ses_dead_hold");
  await writeHookEvent(spoolDirectory, "ses_dead_hold", "notification", TEST_TIME);

  // A process killed mid-hold writes neither the answer nor a closing hook.
  // Past the horizon the standing event refines nothing, and the open turn
  // decays to unknown exactly as it would with no event at all.
  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME + HOOK_NOTIFICATION_HOLD_HORIZON_MS + 60_000,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observation?.holdingForDeveloper, undefined);
});

test("a session-end event reads as complete with the closure as its cause", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeWorkingSession(dataDirectory, "ses_closed");
  await writeHookEvent(spoolDirectory, "ses_closed", "session-end", TEST_TIME);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.COMPLETE);
  assert.equal(observation?.completionCause, SESSION_COMPLETION_CAUSE.SESSION_CLOSED);
});

test("a stop-failure event reads as an error the records cannot show", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeWorkingSession(dataDirectory, "ses_broken");
  await writeHookEvent(spoolDirectory, "ses_broken", "stop-failure", TEST_TIME);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
});

test("a stop event sharpens an open turn the process abandoned", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeWorkingSession(dataDirectory, "ses_ended");
  await writeHookEvent(spoolDirectory, "ses_ended", "stop", TEST_TIME);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, undefined);
});

test("a hook event behind the provider's own clock refines nothing", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeWorkingSession(dataDirectory, "ses_moved_on");
  // A minute behind the session's newest write: the turn it described has
  // already been moved past, so the open turn stands.
  await writeHookEvent(spoolDirectory, "ses_moved_on", "stop", TEST_TIME - 60_000);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a prompt event reads a finished turn as already working again", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeOpenCodeState(
    dataDirectory,
    [{ id: "ses_reprompted", directory: "/Users/test/luke", observedAt: TEST_TIME - 1_000 }],
    {
      messages: [
        {
          id: "msg_01",
          sessionId: "ses_reprompted",
          time: TEST_TIME - 1_000,
          data: {
            role: "assistant",
            time: { created: TEST_TIME - 2_000, completed: TEST_TIME - 1_000 },
          },
        },
      ],
    },
  );
  await writeHookEvent(spoolDirectory, "ses_reprompted", "prompt", TEST_TIME);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  // The plugin can know about a turn the database has not recorded yet.
  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("legacy JSON sessions take the same refinement as database rows", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const spoolDirectory = path.join(dataDirectory, "events");
  await writeLegacySession(dataDirectory, "project-one", {
    id: "ses_legacy_holding",
    title: "Legacy but holding",
    directory: "/Users/test/luke",
    time: { created: TEST_TIME - 5_000, updated: TEST_TIME - 1_000 },
  });
  await writeLegacyMessage(dataDirectory, "ses_legacy_holding", "msg_01", {
    role: "assistant",
    time: { created: TEST_TIME - 1_000 },
  });
  // The file's clock is part of the legacy snapshot's own date, so it must
  // sit at the fixture's time rather than the test run's.
  const sessionFilePath = path.join(
    dataDirectory,
    "storage",
    "session",
    "project-one",
    "ses_legacy_holding.json",
  );
  await fs.utimes(sessionFilePath, (TEST_TIME - 1_000) / 1000, (TEST_TIME - 1_000) / 1000);
  await writeHookEvent(spoolDirectory, "ses_legacy_holding", "notification", TEST_TIME);

  const adapter = new OpenCodeSessionAdapter({
    dataDirectory,
    now: () => TEST_TIME,
    hookEventsDirectory: () => spoolDirectory,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
});
