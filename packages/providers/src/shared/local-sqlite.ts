import { text, type UnparsedWireValue, type WireRecord, wholeNumber } from "@sidecar/wire";
import { Cause, Data, Effect, Exit, Option, type Scope } from "effect";
import { canIgnoreFilesystemError, fileStats } from "./local-files.js";

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

interface SqliteStatement {
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
 * directory means: nothing to observe, not a failed pass.
 */
export function canIgnoreSqliteError(error: Error): boolean {
  if (isNodeError(error) && error.code === "ERR_UNKNOWN_BUILTIN_MODULE") return true;
  return /no such table|no such column|unable to open database file|readonly database/i.test(
    error.message,
  );
}

/** What a refused open threw, carried where nothing but this module reads it. */
class OpenRefused extends Data.TaggedError("OpenRefused")<{ readonly cause: unknown }> {}

/**
 * Opens a provider's own database read-only, or answers nothing where there
 * is nothing to observe. The handle is `readOnly`, so SQLite itself refuses
 * every write this build could make against a file another process owns, and
 * defensive mode is asked for so a corrupt or hostile schema cannot reach
 * anything past the rows a query names. The store's own opener in
 * `@sidecar/brain` is not this one and never can be: it sets journal,
 * synchronous, and foreign-key pragmas and may `VACUUM`, and those are writes
 * a provider's file must never take.
 */
function openHandle(
  sqlite: SqliteModuleLoader,
  filePath: string,
): Effect.Effect<Option.Option<SqliteDatabase>> {
  return Effect.gen(function* () {
    const stats = yield* Effect.promise(() => fileStats(filePath));
    if (!stats?.isFile()) return Option.none();
    const opened = yield* Effect.either(
      Effect.tryPromise({
        try: async () => {
          const module = await sqlite();
          const database = new module.DatabaseSync(filePath, { readOnly: true });
          database.enableDefensive?.(true);
          return database;
        },
        // The refusal carries what was thrown in a field of its own. Reading
        // it off the error Effect would otherwise wrap the failure in would
        // decide this branch on that wrapper's shape, and the branch is the
        // difference between observing nothing here and failing the pass.
        catch: (cause) => new OpenRefused({ cause }),
      }),
    );
    if (opened._tag === "Right") return Option.some(opened.right);
    const cause = opened.left.cause;
    if (
      !(cause instanceof Error) ||
      (!canIgnoreSqliteError(cause) && !canIgnoreFilesystemError(cause))
    ) {
      return yield* Effect.die(cause);
    }
    return Option.none();
  });
}

/**
 * One provider database, open for the life of the scope that asked for it and
 * closed by that scope rather than by a caller's own `finally`. Nothing to
 * observe — an absent file, a runtime without `node:sqlite`, a database
 * another process holds, a schema this build does not know — answers nothing
 * rather than failing the observation pass.
 */
export function scopedReadOnlyDatabase(
  sqlite: SqliteModuleLoader,
  filePath: string,
): Effect.Effect<Option.Option<SqliteDatabase>, never, Scope.Scope> {
  return Effect.acquireRelease(openHandle(sqlite, filePath), (held) =>
    Option.match(held, {
      onNone: () => Effect.void,
      onSome: (database) => Effect.sync(() => database.close()),
    }),
  );
}

/**
 * @deprecated The promise face of {@link scopedReadOnlyDatabase}, whose
 * caller closes the handle itself in a `finally`; deleted with P6-11a and
 * P6-11b, which move each adapter's read into a scope.
 */
export async function openReadOnlyDatabase(
  sqlite: SqliteModuleLoader,
  filePath: string,
): Promise<SqliteDatabase | undefined> {
  // The open's own unexpected errors are defects, so what the promise rejects
  // with is the error itself rather than the fiber's wrapping of it: a caller
  // reading `canIgnoreSqliteError` off a rejection reads what it always did.
  const exit = await Effect.runPromiseExit(openHandle(sqlite, filePath));
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return Option.getOrUndefined(exit.value);
}
