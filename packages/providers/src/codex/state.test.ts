import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "vitest";
import { defaultSqliteModule, textFromRow } from "../shared/local-sqlite.js";
import { temporaryDirectory } from "../testing/temporary-directory.js";
import { rolloutPathForThread, threadRows } from "./state.js";

const CODEX_STATE_DATABASE = "state_5.sqlite";
const CODEX_SQLITE_HOME = "CODEX_SQLITE_HOME";
const NOW = Date.parse("2026-08-11T23:45:00.000Z");

/**
 * The columns the thread query actually reads. A real Codex database carries
 * many more, which is exactly why the projection is `*`: a column this build
 * names but an install lacks would fail the whole query.
 */
function writeStateDatabase(
  directory: string,
  threads: readonly { id: string; cwd: string; rolloutPath?: string }[],
): void {
  const database = new DatabaseSync(path.join(directory, CODEX_STATE_DATABASE), {});
  try {
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        rollout_path TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER,
        updated_at_ms INTEGER,
        recency_at_ms INTEGER NOT NULL DEFAULT 0
      )
    `);
    for (const thread of threads) {
      database
        .prepare("INSERT INTO threads (id, cwd, rollout_path, recency_at_ms) VALUES (?, ?, ?, ?)")
        .run(thread.id, thread.cwd, thread.rolloutPath ?? "", NOW);
    }
  } finally {
    database.close();
  }
}

async function seed(
  directory: string,
  threads: readonly { id: string; cwd: string; rolloutPath?: string }[],
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  writeStateDatabase(directory, threads);
}

/** Restores whatever the shell had, so one case cannot decide another's. */
function withSqliteHome(t: TestContext, value: string | undefined): void {
  const previous = process.env[CODEX_SQLITE_HOME];
  if (value === undefined) delete process.env[CODEX_SQLITE_HOME];
  else process.env[CODEX_SQLITE_HOME] = value;
  t.onTestFinished(() => {
    if (previous === undefined) delete process.env[CODEX_SQLITE_HOME];
    else process.env[CODEX_SQLITE_HOME] = previous;
  });
}

async function observedThreadIds(
  codexHome: string,
  sqliteHome?: string,
): Promise<readonly (string | undefined)[]> {
  const rows = await threadRows({
    codexHome,
    ...(sqliteHome === undefined ? undefined : { sqliteHome }),
    sqlite: defaultSqliteModule,
  });
  return rows.map((row) => textFromRow(row, "id"));
}

/**
 * Where Codex's state database may be, most authoritative first: an explicit
 * home, then the one `config.toml` names, then `CODEX_SQLITE_HOME`, then the
 * paths Codex writes by default. Each case seeds only the home it is about,
 * plus whatever it must be seen to outrank.
 */
const LOCATION_CASE: readonly {
  readonly name: string;
  readonly configuration?: string;
  readonly environmentHome?: string;
  readonly explicitHome?: string;
  readonly seed: readonly string[];
  readonly threadId: string;
}[] = [
  {
    name: "reads an explicitly named SQLite home",
    explicitHome: "sqlite-state",
    seed: ["sqlite-state"],
    threadId: "sqlite-state",
  },
  {
    name: "reads the sqlite_home the configuration names",
    configuration: "sqlite_home = 'configured-sqlite'\n",
    seed: ["configured-sqlite"],
    threadId: "configured-sqlite",
  },
  {
    name: "reads the sqlite home the environment names",
    environmentHome: "env-sqlite",
    seed: ["env-sqlite"],
    threadId: "env-sqlite",
  },
  {
    name: "prefers the configured sqlite_home over the environment's",
    configuration: "sqlite_home = 'configured-sqlite'\n",
    environmentHome: "env-sqlite",
    seed: ["env-sqlite", "configured-sqlite"],
    threadId: "configured-sqlite",
  },
  {
    name: "reads the default sqlite subdirectory",
    seed: ["sqlite"],
    threadId: "sqlite",
  },
];

for (const locationCase of LOCATION_CASE) {
  test(locationCase.name, async (t) => {
    const codexHome = await temporaryDirectory(t, "luke-codex-state-");
    withSqliteHome(
      t,
      locationCase.environmentHome === undefined
        ? undefined
        : path.join(codexHome, locationCase.environmentHome),
    );
    if (locationCase.configuration) {
      await fs.writeFile(path.join(codexHome, "config.toml"), locationCase.configuration);
    }
    for (const directory of locationCase.seed) {
      await seed(path.join(codexHome, directory), [
        { id: directory, cwd: `/Users/test/${directory}` },
      ]);
    }

    assert.deepEqual(
      await observedThreadIds(
        codexHome,
        locationCase.explicitHome === undefined
          ? undefined
          : path.join(codexHome, locationCase.explicitHome),
      ),
      [locationCase.threadId],
    );
  });
}

test("falls back when a higher-priority database has an unusable schema", async (t) => {
  const codexHome = await temporaryDirectory(t, "luke-codex-state-");
  withSqliteHome(t, undefined);
  await fs.mkdir(path.join(codexHome, "sqlite"), { recursive: true });
  const malformed = new DatabaseSync(path.join(codexHome, "sqlite", CODEX_STATE_DATABASE), {});
  try {
    malformed.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  } finally {
    malformed.close();
  }
  await seed(codexHome, [{ id: "legacy-valid", cwd: "/Users/test/legacy-valid" }]);

  assert.deepEqual(await observedThreadIds(codexHome), ["legacy-valid"]);
});

test("answers nothing where Codex has no state database at all", async (t) => {
  const codexHome = await temporaryDirectory(t, "luke-codex-state-");
  withSqliteHome(t, undefined);

  assert.deepEqual(await observedThreadIds(codexHome), []);
});

test("answers nothing when node's SQLite module is unavailable", async (t) => {
  const codexHome = await temporaryDirectory(t, "luke-codex-state-");
  withSqliteHome(t, undefined);
  await seed(codexHome, [{ id: "codex-active", cwd: "/Users/test/luke" }]);
  // SAFETY: the loader throws exactly the shape Node throws for a runtime
  // built without `node:sqlite`, which is the case under test.
  const error = new Error("No such built-in module: node:sqlite") as NodeJS.ErrnoException;
  error.code = "ERR_UNKNOWN_BUILTIN_MODULE";

  const rows = await threadRows({
    codexHome,
    sqlite: async () => {
      throw error;
    },
  });

  assert.deepEqual(rows, []);
});

test("names a thread's rollout from the thread's own row, never from its id", async (t) => {
  const codexHome = await temporaryDirectory(t, "luke-codex-state-");
  withSqliteHome(t, undefined);
  await seed(codexHome, [
    { id: "codex-live", cwd: "/Users/test/luke", rolloutPath: "/tmp/rollout-live.jsonl" },
  ]);
  const location = { codexHome, sqlite: defaultSqliteModule };

  assert.equal(await rolloutPathForThread(location, "codex-live"), "/tmp/rollout-live.jsonl");
  assert.equal(await rolloutPathForThread(location, "'; DROP TABLE threads; --"), undefined);
});
