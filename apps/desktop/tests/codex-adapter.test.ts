import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import { CODEX_PROVIDER, CodexSessionAdapter } from "../src/codex-adapter";

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const CODEX_STATE_DATABASE = "state_5.sqlite";
const TEST_CODEX_SOURCE = {
  CLI: "cli",
} as const;
const TEST_CODEX_MODEL_PROVIDER = {
  OPENAI_SSE: "openai_sse",
} as const;
const TEST_SQLITE_ERROR = {
  UNKNOWN_BUILTIN_MODULE: "ERR_UNKNOWN_BUILTIN_MODULE",
} as const;
const TEST_CODEX_ENVIRONMENT = {
  SQLITE_DIRECTORY: "CODEX_SQLITE_HOME",
} as const;

interface TestThread {
  id: string;
  cwd: string;
  observedAt: number;
  archived?: number;
  title?: string;
  preview?: string;
  firstUserMessage?: string;
}

async function temporaryCodexHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-codex-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function writeThread(database: DatabaseSync, thread: TestThread): void {
  database
    .prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        created_at,
        updated_at,
        source,
        model_provider,
        cwd,
        title,
        sandbox_policy,
        approval_mode,
        archived,
        first_user_message,
        created_at_ms,
        updated_at_ms,
        preview,
        recency_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      thread.id,
      "",
      Math.floor(thread.observedAt / 1000),
      Math.floor(thread.observedAt / 1000),
      TEST_CODEX_SOURCE.CLI,
      TEST_CODEX_MODEL_PROVIDER.OPENAI_SSE,
      thread.cwd,
      thread.title ?? "",
      "workspace-write",
      "never",
      thread.archived ?? 0,
      thread.firstUserMessage ?? "",
      thread.observedAt,
      thread.observedAt,
      thread.preview ?? "",
      thread.observedAt,
    );
}

async function writeCodexState(codexHome: string, threads: readonly TestThread[]): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        first_user_message TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER,
        updated_at_ms INTEGER,
        preview TEXT NOT NULL DEFAULT '',
        recency_at_ms INTEGER NOT NULL DEFAULT 0
      )
    `);
    for (const thread of threads) writeThread(database, thread);
  } finally {
    database.close();
  }
}

async function writeCodexConfig(codexHome: string, source: string): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), source);
}

async function writeMalformedCodexState(codexHome: string): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    database.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  } finally {
    database.close();
  }
}

test("observes Codex sessions without exposing transcript-derived metadata", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-active",
      cwd: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
      title: SECRET_TRANSCRIPT_TEXT,
      preview: SECRET_TRANSCRIPT_TEXT,
      firstUserMessage: SECRET_TRANSCRIPT_TEXT,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, CODEX_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-active");
  assert.equal(observations[0]?.title, "Codex: luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.controls, undefined);
  assert.equal(JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT), false);
});

test("observes Codex sessions from an explicit SQLite home", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const sqliteHome = path.join(codexHome, "sqlite-state");
  await writeCodexState(sqliteHome, [
    {
      id: "codex-sqlite-home",
      cwd: "/Users/test/sqlite-home",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    sqliteHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-sqlite-home");
  assert.equal(observations[0]?.title, "Codex: sqlite-home");
});

test("observes Codex sessions from configured sqlite_home", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const previousSqliteHome = process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  t.after(() => {
    if (previousSqliteHome === undefined)
      delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
    else process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = previousSqliteHome;
  });
  await writeCodexConfig(codexHome, "sqlite_home = 'configured-sqlite'\n");
  await writeCodexState(path.join(codexHome, "configured-sqlite"), [
    {
      id: "codex-configured-home",
      cwd: "/Users/test/configured-home",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-configured-home");
  assert.equal(observations[0]?.title, "Codex: configured-home");
});

test("observes Codex sessions from CODEX_SQLITE_HOME", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const sqliteHome = path.join(codexHome, "env-sqlite");
  const previousSqliteHome = process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = sqliteHome;
  t.after(() => {
    if (previousSqliteHome === undefined)
      delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
    else process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = previousSqliteHome;
  });
  await writeCodexState(sqliteHome, [
    {
      id: "codex-env-home",
      cwd: "/Users/test/env-home",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-env-home");
  assert.equal(observations[0]?.title, "Codex: env-home");
});

test("prefers configured sqlite_home over CODEX_SQLITE_HOME", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const envSqliteHome = path.join(codexHome, "env-sqlite");
  const previousSqliteHome = process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = envSqliteHome;
  t.after(() => {
    if (previousSqliteHome === undefined)
      delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
    else process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = previousSqliteHome;
  });
  await writeCodexConfig(codexHome, "sqlite_home = 'configured-sqlite'\n");
  await writeCodexState(envSqliteHome, [
    {
      id: "codex-env-home",
      cwd: "/Users/test/env-home",
      observedAt: TEST_TIME - 1_000,
    },
  ]);
  await writeCodexState(path.join(codexHome, "configured-sqlite"), [
    {
      id: "codex-configured-home",
      cwd: "/Users/test/configured-home",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-configured-home");
  assert.equal(observations[0]?.title, "Codex: configured-home");
});

test("observes Codex sessions from the default sqlite subdirectory", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(path.join(codexHome, "sqlite"), [
    {
      id: "codex-default-sqlite",
      cwd: "/Users/test/default-sqlite",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-default-sqlite");
  assert.equal(observations[0]?.title, "Codex: default-sqlite");
});

test("falls back when a higher-priority Codex database has an unusable schema", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeMalformedCodexState(path.join(codexHome, "sqlite"));
  await writeCodexState(codexHome, [
    {
      id: "codex-legacy-valid",
      cwd: "/Users/test/legacy-valid",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-legacy-valid");
  assert.equal(observations[0]?.title, "Codex: legacy-valid");
});

test("keeps stale unarchived Codex sessions unknown instead of inventing activity", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-stale",
      cwd: "/Users/test/stale",
      observedAt: TEST_TIME - 20 * 60 * 1000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60 * 60 * 1000,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("filters old and archived Codex threads while preserving newest sessions", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "old-session",
      cwd: "/Users/test/old",
      observedAt: TEST_TIME - 90_000,
    },
    {
      id: "archived-session",
      cwd: "/Users/test/archived",
      observedAt: TEST_TIME - 1_000,
      archived: 1,
    },
    {
      id: "new-session",
      cwd: "/Users/test/new",
      observedAt: TEST_TIME - 10_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => ({
      providerSessionId: observation.providerSessionId,
      status: observation.status,
      title: observation.title,
    })),
    [
      {
        providerSessionId: "new-session",
        status: SESSION_STATUS.WORKING,
        title: "Codex: new",
      },
    ],
  );
});

test("returns an empty snapshot when Codex has no local state database", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });

  assert.deepEqual(await adapter.observe(), []);
});

test("returns an empty snapshot when node sqlite is unavailable", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-active",
      cwd: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
    },
  ]);
  const error = new Error("No such built-in module: node:sqlite") as NodeJS.ErrnoException;
  error.code = TEST_SQLITE_ERROR.UNKNOWN_BUILTIN_MODULE;

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    sqlite: async () => {
      throw error;
    },
  });

  assert.deepEqual(await adapter.observe(), []);
});
