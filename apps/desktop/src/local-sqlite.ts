import { text, wholeNumber } from "@sidecar/core";
import { canIgnoreFilesystemError, fileStats } from "./local-session-adapter";

export function numberFromRow(row: Record<string, unknown>, key: string): number | undefined {
  return wholeNumber(row[key]);
}

export function textFromRow(row: Record<string, unknown>, key: string): string | undefined {
  return text(row[key]);
}

/**
 * The shared half of every adapter that reads a provider's SQLite state:
 * read-only opens of a database another process owns, and the errors that mean
 * "observe nothing here" rather than "the observation pass failed". Nothing
 * here opens a database for writing, and no caller may.
 */

export interface SqliteStatement {
  all(...anonymousParameters: readonly unknown[]): unknown[];
}

export interface SqliteDatabase {
  close(): void;
  enableDefensive?(enabled: boolean): void;
  prepare(source: string): SqliteStatement;
}

export interface SqliteModule {
  DatabaseSync: new (location: string, options: { readOnly: boolean }) => SqliteDatabase;
}

export type SqliteModuleLoader = () => Promise<SqliteModule>;

export async function defaultSqliteModule(): Promise<SqliteModule> {
  return (await import("node:sqlite")) as SqliteModule;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * A runtime without `node:sqlite`, a database another process holds, or a
 * schema this build does not know all mean the same thing an absent provider
 * directory means: nothing to observe, not a failed pass.
 */
export function canIgnoreSqliteError(error: unknown): boolean {
  if (isNodeError(error) && error.code === "ERR_UNKNOWN_BUILTIN_MODULE") return true;
  if (!(error instanceof Error)) return false;
  return /no such table|no such column|unable to open database file|readonly database/i.test(
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
    return database;
  } catch (error) {
    if (canIgnoreSqliteError(error) || canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}
