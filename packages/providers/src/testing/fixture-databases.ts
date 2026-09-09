import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Where Codex keeps the state database its threads live in, relative to a
 * Codex home. Named here rather than imported because the fixture builds the
 * file the adapter is under test for reading.
 */
const CODEX_STATE_DATABASE_PATH = ["state_5.sqlite"] as const;

/** Where Superset keeps one organization's host database, under its own home. */
const SUPERSET_HOST_DATABASE_PATH = ["host", "fixture-organization", "host.db"] as const;

/**
 * Applies a fixture's DDL to a database file that does not exist yet.
 *
 * A committed binary is not a readable fixture, so a provider's SQLite state
 * is recorded as the script that builds it and applied here. `node:sqlite` is
 * used directly rather than the package's own read-only opener, which is one
 * of the things under test.
 */
async function applyFixtureDatabase(databasePath: string, sql: string): Promise<void> {
  const existing = await fs.stat(databasePath).catch(() => undefined);
  if (existing !== undefined) {
    throw new Error(`a fixture database already stands at ${databasePath}`);
  }
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

export function codexStateDb(home: string, sql: string): Promise<void> {
  return applyFixtureDatabase(path.join(home, ...CODEX_STATE_DATABASE_PATH), sql);
}

export function conductorDb(home: string, sql: string): Promise<void> {
  return applyFixtureDatabase(path.join(home, "conductor.db"), sql);
}

export function supersetHostDb(home: string, sql: string): Promise<void> {
  return applyFixtureDatabase(path.join(home, ...SUPERSET_HOST_DATABASE_PATH), sql);
}
