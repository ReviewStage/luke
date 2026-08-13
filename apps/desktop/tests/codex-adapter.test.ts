import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import { CODEX_PROVIDER, CodexSessionAdapter } from "../src/codex-adapter";

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
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
  rolloutPath?: string;
  gitBranch?: string;
  model?: string;
  reasoningEffort?: string;
}

async function writeRollout(
  filePath: string,
  records: readonly Record<string, unknown>[],
): Promise<void> {
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
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
        recency_at_ms,
        git_branch,
        model,
        reasoning_effort
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      thread.id,
      thread.rolloutPath ?? "",
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
      thread.gitBranch ?? null,
      thread.model ?? null,
      thread.reasoningEffort ?? null,
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
        recency_at_ms INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        model TEXT,
        reasoning_effort TEXT
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

test("observes a Codex thread under the name Codex gave it", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-active",
      cwd: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
      title: "Release stage-cli to npm",
      gitBranch: "codex/bump-version",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
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
  assert.equal(observations[0]?.title, "Release stage-cli to npm");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.controls, undefined);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    branch: "codex/bump-version",
    model: "gpt-5.6-luna · medium",
    link: "codex://threads/codex-active",
  });
});

test("addresses a Codex thread by the id Codex files it under", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      // A real thread id is a UUID, but the id is Codex's to choose and it is
      // carried into an address, so one needing escaping proves it is escaped
      // rather than pasted in.
      id: "codex thread/one?two",
      cwd: "/Users/test/luke",
      observedAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.detail?.link, "codex://threads/codex%20thread%2Fone%3Ftwo");
});

test("reports a finished Codex turn as waiting for its developer", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-complete.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-done", cwd: "/Users/test/luke", observedAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pnpm test","workdir":"/Users/test/luke"}',
      },
    },
    {
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "Released 0.1.6 and merged the PR." },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.summary, "Released 0.1.6 and merged the PR.");
  assert.equal(observation?.detail?.activity, undefined);
});

test("reports a running Codex turn as working with the call it is making", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-running.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-running", cwd: "/Users/test/luke", observedAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Earlier turn." } },
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pnpm test","workdir":"/Users/test/luke"}',
      },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.summary, undefined);
  assert.equal(observation?.detail?.activity, "exec_command: pnpm test");
});

test("names a call whose argument Codex passes as a list of tokens", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-list-argument.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-list-arg", cwd: "/Users/test/luke", observedAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "run",
        // Codex passes a search's terms as a list rather than a string.
        arguments: '{"search_query":["notch","geometry","inset"]}',
      },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.detail?.activity, "run: notch geometry inset");
});

test("names a call by its tool alone when no argument reads as a phrase", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-structured-argument.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-structured", cwd: "/Users/test/luke", observedAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        // A plan's steps are objects, and flattening them would be noise.
        arguments: '{"plan":[{"step":"Read the adapter","status":"done"}]}',
      },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.detail?.activity, "update_plan");
});

test("drops the previous turn's call when a new Codex turn starts", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-new-turn.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-new-turn", cwd: "/Users/test/luke", observedAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pnpm test","workdir":"/Users/test/luke"}',
      },
    },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Tests pass." } },
    { type: "event_msg", payload: { type: "task_started" } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    maximumSessionAgeMs: 60_000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, undefined);
  assert.equal(observation?.summary, undefined);
});

test("holds a long Codex turn at working however stale its row is", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-long.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-long-turn",
      cwd: "/Users/test/luke",
      observedAt: TEST_TIME - 30 * 60 * 1000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [{ type: "event_msg", payload: { type: "task_started" } }]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
    maximumSessionAgeMs: 60 * 60 * 1000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
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
  assert.equal(observations[0]?.title, "sqlite-home");
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
  assert.equal(observations[0]?.title, "configured-home");
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
  assert.equal(observations[0]?.title, "env-home");
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
  assert.equal(observations[0]?.title, "configured-home");
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
  assert.equal(observations[0]?.title, "default-sqlite");
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
  assert.equal(observations[0]?.title, "legacy-valid");
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
        title: "new",
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
