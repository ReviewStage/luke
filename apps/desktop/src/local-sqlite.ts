import type { Stats } from "node:fs";
import { text, type UnparsedWireValue, type WireRecord, wholeNumber } from "@sidecar/core";
import { Effect } from "effect";
import { canIgnoreFilesystemError } from "./local-session-adapter";
import { type FileFailure, Files } from "./services/files";

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
  prepare(source: string): SqliteStatement;
}

export interface SqliteModule {
  DatabaseSync: new (location: string, options: { readOnly: boolean }) => SqliteDatabase;
}

export type SqliteModuleLoader = () => Effect.Effect<SqliteModule, FileFailure, Files>;

export const defaultSqliteModule: SqliteModuleLoader = () =>
  Effect.gen(function* () {
    const files = yield* Files;
    return yield* files.dynamicImport<SqliteModule>("node:sqlite");
  });

function isNodeError(error: Error): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * A runtime without `node:sqlite`, a database another process holds, or a
 * schema this build does not know all mean the same thing an absent provider
 * directory means: nothing to observe, not a failed pass.
 */
export function canIgnoreSqliteError(error: Error): boolean {
  if (isNodeError(error) && error.code === "ERR_UNKNOWN_BUILTIN_MODULE") return true;
  return /no such table|no such column|unable to open database file|readonly database/i.test(
    error.message,
  );
}

function optionalStat(filePath: string): Effect.Effect<Stats | undefined, FileFailure, Files> {
  return Effect.gen(function* () {
    const files = yield* Files;
    return yield* files.stat(filePath);
  });
}

export function openReadOnlyDatabase(
  sqlite: SqliteModuleLoader,
  filePath: string,
): Effect.Effect<SqliteDatabase | undefined, FileFailure | unknown, Files> {
  return Effect.gen(function* () {
    const stats = yield* optionalStat(filePath);
    if (!stats?.isFile()) return undefined;

    const module = yield* sqlite().pipe(
      Effect.catchAll((error) => {
        if (error instanceof Error && canIgnoreSqliteError(error)) {
          return Effect.succeed(undefined);
        }
        return Effect.fail(error);
      }),
    );
    if (!module) return undefined;

    return yield* Effect.try({
      try: () => {
        const database = new module.DatabaseSync(filePath, { readOnly: true });
        database.enableDefensive?.(true);
        return database;
      },
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) => {
        if (
          error instanceof Error &&
          (canIgnoreSqliteError(error) || canIgnoreFilesystemError(error))
        ) {
          return Effect.succeed(undefined);
        }
        return Effect.fail(error);
      }),
    );
  });
}
