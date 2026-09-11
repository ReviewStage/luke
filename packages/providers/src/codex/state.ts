import path from "node:path";
import { isRecord, text, type WireRecord } from "@sidecar/wire";
import { Data, Effect, Option } from "effect";
import { uniquePaths } from "../shared/local-files.js";
import {
  canIgnoreSqliteError,
  type SqliteDatabase,
  type SqliteModuleLoader,
  scopedReadOnlyDatabase,
} from "../shared/local-sqlite.js";
import { normalizeDirectory, sqliteHomeFromConfig, sqliteHomeFromEnvironment } from "./config.js";

/**
 * Codex's own state database, read and nothing else. It is the one module
 * that opens that file, so the observation pass and the transcript read reach
 * the same rows through the same query and neither depends on the other —
 * which is what they used to do, in a cycle.
 */

const CODEX_DATABASE_FILE = {
  STATE: "state_5.sqlite",
} as const;

export const CODEX_SESSION_INDEX_FILE = "session_index.jsonl";

export const CODEX_THREAD_COLUMN = {
  ID: "id",
  SOURCE: "source",
  CWD: "cwd",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  CREATED_AT_MS: "created_at_ms",
  UPDATED_AT_MS: "updated_at_ms",
  RECENCY_AT_MS: "recency_at_ms",
  TITLE: "title",
  FIRST_USER_MESSAGE: "first_user_message",
  GIT_BRANCH: "git_branch",
  MODEL: "model",
  REASONING_EFFORT: "reasoning_effort",
  ROLLOUT_PATH: "rollout_path",
} as const;

export type CodexThreadRow = WireRecord;

// Every column is read defensively from the row, so the projection stays `*`:
// Codex adds columns by migration, and naming one this build expects but an
// older install lacks would fail the whole query rather than one field.
// An archived thread is one the user filed away in Codex's own UI, so it is
// no row at all rather than a completed one — the same reading OpenCode's
// archived sessions get — and archiving touches the row's clock, so anything
// short of excluding it outright would resurface it as fresh.
const CODEX_THREAD_QUERY = `
  WITH observed_threads AS (
    SELECT
      *,
      MAX(
        COALESCE(recency_at_ms, 0),
        COALESCE(updated_at_ms, 0),
        COALESCE(created_at_ms, 0),
        COALESCE(updated_at, 0) * 1000,
        COALESCE(created_at, 0) * 1000
      ) AS luke_observed_at_ms
    FROM threads
  )
  SELECT *
  FROM observed_threads
  WHERE id <> ''
    AND cwd <> ''
    AND archived = 0
  ORDER BY luke_observed_at_ms DESC,
    id DESC
`;

const CODEX_THREAD_ROLLOUT_QUERY = `
  SELECT rollout_path
  FROM threads
  WHERE id = ?
`;

export interface CodexStateLocation {
  codexHome: string;
  sqliteHome?: string;
  sqlite: SqliteModuleLoader;
}

/**
 * Where Codex's state database may be, most authoritative first: an explicit
 * home, then the one `config.toml` names, then wherever `CODEX_SQLITE_HOME`
 * points, then the paths Codex writes by default.
 */
async function stateDatabasePaths(
  codexHome: string,
  configuredSqliteHome: string | undefined,
): Promise<string[]> {
  const sqliteHome =
    normalizeDirectory(configuredSqliteHome, codexHome) ??
    (await sqliteHomeFromConfig(codexHome)) ??
    sqliteHomeFromEnvironment(codexHome);
  return uniquePaths(
    [
      sqliteHome && path.join(sqliteHome, CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, "sqlite", CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, CODEX_DATABASE_FILE.STATE),
    ].filter((candidate): candidate is string => candidate !== undefined),
  );
}

/** What a refused question threw, carried where nothing but this module reads it. */
class AskRefused extends Data.TaggedError("AskRefused")<{ readonly cause: unknown }> {}

/**
 * Asks one open database its question. A schema this build does not know is
 * the same answer an absent database is — nothing here — and anything else
 * is a defect, because the difference is between observing nothing in this
 * file and failing the pass.
 */
function askDatabase<Answer>(
  database: SqliteDatabase,
  ask: (database: SqliteDatabase) => Answer | undefined,
): Effect.Effect<Answer | undefined> {
  return Effect.gen(function* () {
    const asked = yield* Effect.either(
      Effect.try({ try: () => ask(database), catch: (cause) => new AskRefused({ cause }) }),
    );
    if (asked._tag === "Right") return asked.right;
    const cause = asked.left.cause;
    if (!(cause instanceof Error) || !canIgnoreSqliteError(cause)) return yield* Effect.die(cause);
    return undefined;
  });
}

/**
 * Asks each candidate database one question, stopping at the first that
 * answers. Each database is open only inside its own scope, which closes the
 * handle, so the reads that follow never hold a lock on state Codex itself
 * is writing.
 */
function askEachDatabase<Answer>(
  location: CodexStateLocation,
  ask: (database: SqliteDatabase) => Answer | undefined,
): Effect.Effect<Answer | undefined> {
  return Effect.gen(function* () {
    const databasePaths = yield* Effect.promise(() =>
      stateDatabasePaths(location.codexHome, location.sqliteHome),
    );
    for (const databasePath of databasePaths) {
      const answer = yield* Effect.scoped(
        Effect.flatMap(scopedReadOnlyDatabase(location.sqlite, databasePath), (held) =>
          Option.match(held, {
            onNone: () => Effect.succeed(undefined),
            onSome: (database) => askDatabase(database, ask),
          }),
        ),
      );
      if (answer !== undefined) return answer;
    }
    return undefined;
  });
}

/**
 * Every thread Codex holds, newest first, from the first readable database.
 * The rows come back with the file already closed, so the reads that follow
 * one — a rollout tail, a hook spool — never hold a lock on state Codex
 * itself is writing.
 */
export function threadRows(location: CodexStateLocation): Effect.Effect<readonly CodexThreadRow[]> {
  return Effect.map(
    askEachDatabase(location, (database) =>
      database
        .prepare(CODEX_THREAD_QUERY)
        .all()
        .filter((row): row is CodexThreadRow => isRecord(row)),
    ),
    (rows) => rows ?? [],
  );
}

/**
 * The rollout file one thread's own row names, read through a parameterized
 * lookup and never composed from the id.
 */
export function rolloutPathForThread(
  location: CodexStateLocation,
  providerSessionId: string,
): Effect.Effect<string | undefined> {
  return askEachDatabase(location, (database) => {
    const row = database.prepare(CODEX_THREAD_ROLLOUT_QUERY).all(providerSessionId)[0];
    return isRecord(row) ? text(row.rollout_path) : undefined;
  });
}
