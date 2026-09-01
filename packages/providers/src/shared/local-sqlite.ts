import { text, type UnparsedWireValue, type WireRecord, wholeNumber } from "@sidecar/wire";
import { canIgnoreFilesystemError, fileStats } from "./local-session-adapter.js";

export function numberFromRow(row: WireRecord, key: string): number | undefined {
  return wholeNumber(row[key]);
}

export function textFromRow(row: WireRecord, key: string): string | undefined {
  return text(row[key]);
}

/**
 * The shared half of every adapter that reads a provider's SQLite state:
 * read-only opens of a database another process owns, and the errors that mean
 * "observe nothing here" rather than "the observation pass failed". Nothing
 * here opens a database for writing, and no caller may.
 */

export interface SqliteStatement {
  all(...anonymousParameters: readonly unknown[]): UnparsedWireValue[];
}

export interface SqliteDatabase {
  close(): void;
  enableDefensive?(enabled: boolean): void;
  exec?(source: string): void;
  prepare(source: string): SqliteStatement;
}

export interface SqliteModule {
  DatabaseSync: new (location: string, options: { readOnly: boolean }) => SqliteDatabase;
}

export type SqliteModuleLoader = () => Promise<SqliteModule>;

export async function defaultSqliteModule(): Promise<SqliteModule> {
  // SAFETY: SqliteModule is the exact read-only subset this adapter uses from node:sqlite.
  return (await import("node:sqlite")) as SqliteModule;
}

function isNodeError(error: Error): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * A runtime without `node:sqlite`, a database another process holds, or a
 * schema this build does not know all mean the same thing an absent provider
 * directory means: nothing to observe, not a failed pass. A locked database
 * is the same answer with a clock on it — the provider is mid-write, and the
 * next pass reads what it was writing — so the busy wait below rides out the
 * common case and this reads the residue as a quiet pass rather than a
 * failure.
 */
export function canIgnoreSqliteError(error: Error): boolean {
  if (isNodeError(error) && error.code === "ERR_UNKNOWN_BUILTIN_MODULE") return true;
  return /no such table|no such column|unable to open database file|readonly database|database is locked/i.test(
    error.message,
  );
}

export async function openReadOnlyDatabase(
  sqlite: SqliteModuleLoader,
  filePath: string,
): Promise<SqliteDatabase | undefined> {
  const stats = await fileStats(filePath);
  if (!stats?.isFile()) return undefined;

  try {
    const module = await sqlite();
    const database = new module.DatabaseSync(filePath, { readOnly: true });
    database.enableDefensive?.(true);
    // Another process owns this database and may be mid-write, and a second
    // Luke instance observing beside the released one doubles how often a
    // read lands inside a writer's lock. A short busy wait rides those
    // moments out; a lock that outlives it is read as nothing to observe.
    try {
      database.exec?.("PRAGMA busy_timeout = 250");
    } catch {
      // A connection that refuses the pragma reads without the wait.
    }
    return database;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (!canIgnoreSqliteError(error) && !canIgnoreFilesystemError(error))
    ) {
      throw error;
    }
    return undefined;
  }
}
