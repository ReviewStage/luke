/**
 * Bringing a store's schema to this build's version, as one Effect over the
 * `@effect/sql` client. `STORE_SCHEMA_MIGRATIONS` stays what it is — data,
 * read here and written nowhere — and the version the file stands at stays
 * where it has always been, the one row of the `schema_version` table, rather
 * than a marker of a migrator's own: a second place to look is a second place
 * to disagree, and a store already in the field carries this one.
 *
 * The whole upgrade is one transaction, the outermost `BEGIN IMMEDIATE` of
 * the run: the version is read, the current statements create what is
 * missing, every step from the standing version forward runs in order, and
 * the version row is written, all of it or none of it. A step that fails
 * leaves the file at the version it was opened at, with the tables it was
 * opened with, because a database half-walked-forward is one no later launch
 * could tell from a database at either version.
 */

import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Cause, Data, Effect, Exit, type Layer, Option, Schema } from "effect";
import {
  type SchemaMigrationStep,
  STORE_SCHEMA_FLOOR,
  STORE_SCHEMA_MIGRATIONS,
  STORE_SCHEMA_STATEMENTS,
  STORE_SCHEMA_VERSION,
} from "./schema.js";

/**
 * A database at a version this build cannot reach from — past its own, or
 * before the floor it carries forward from — is refused rather than migrated
 * by guess.
 */
export class StoreSchemaRefused extends Data.TaggedError("StoreSchemaRefused")<{
  readonly version: number;
}> {
  override get message(): string {
    return `the brain's store is at schema version ${this.version}, not ${STORE_SCHEMA_VERSION}`;
  }
}

/**
 * The version column is declared INTEGER and written by this module alone, so
 * a row of any other shape is a violation of the schema this file owns rather
 * than a version to reason about.
 */
const decodeVersions = Schema.decodeUnknown(
  Schema.Array(Schema.Struct({ version: Schema.Number })),
);

/** The version the file stands at, or none where nothing has written one yet. */
const standingVersion: Effect.Effect<
  Option.Option<number>,
  SqlError,
  Client.SqlClient
> = Effect.gen(function* () {
  const sql = yield* Client.SqlClient;
  const versioned = yield* sql.unsafe(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
  );
  if (versioned.length === 0) return Option.none();
  const rows = yield* sql.unsafe("SELECT version FROM schema_version");
  const versions = yield* Effect.orDie(decodeVersions(rows));
  const first = versions[0];
  return first === undefined ? Option.none() : Option.some(first.version);
});

/** Whether the named table, or the named column of it, stands. */
const stands = (target: {
  readonly table: string;
  readonly column?: string;
}): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const table = yield* sql.unsafe(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      [target.table],
    );
    if (table.length === 0) return false;
    if (target.column === undefined) return true;
    const column = yield* sql.unsafe("SELECT 1 FROM pragma_table_info(?) WHERE name = ?", [
      target.table,
      target.column,
    ]);
    return column.length > 0;
  });

const applyStep = (step: SchemaMigrationStep): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    if (step.onlyIf !== undefined && !(yield* stands(step.onlyIf))) return;
    if (step.unless !== undefined && (yield* stands(step.unless))) return;
    yield* sql.unsafe(step.sql, step.params);
  });

const upgrade: Effect.Effect<void, SqlError | StoreSchemaRefused, Client.SqlClient> = Effect.gen(
  function* () {
    const sql = yield* Client.SqlClient;
    const standing = yield* standingVersion;
    if (
      Option.isSome(standing) &&
      (standing.value > STORE_SCHEMA_VERSION || standing.value < STORE_SCHEMA_FLOOR)
    ) {
      return yield* Effect.fail(new StoreSchemaRefused({ version: standing.value }));
    }
    // The current statements run first: each creates a table only where none
    // stands, so a table a later version added exists before a step that
    // fills it from the older ones, and a table that already stands is left
    // for its step to alter.
    yield* Effect.forEach(STORE_SCHEMA_STATEMENTS, (statement) => sql.unsafe(statement), {
      discard: true,
    });
    if (Option.isSome(standing)) {
      // A version the map names no steps for changed only what the current
      // statements already create, so it migrates by having nothing to do.
      for (let version = standing.value + 1; version <= STORE_SCHEMA_VERSION; version += 1) {
        yield* Effect.forEach(STORE_SCHEMA_MIGRATIONS.get(version) ?? [], applyStep, {
          discard: true,
        });
      }
    }
    yield* Option.match(standing, {
      onNone: () =>
        sql.unsafe("INSERT INTO schema_version (version) VALUES (?)", [STORE_SCHEMA_VERSION]),
      onSome: (version) =>
        version === STORE_SCHEMA_VERSION
          ? Effect.void
          : sql.unsafe("UPDATE schema_version SET version = ?", [STORE_SCHEMA_VERSION]),
    });
  },
);

/**
 * Brings the schema to this build's version, or refuses a database at one it
 * cannot reach from. Every statement runs inside the one transaction, so a
 * failed step leaves the version and the tables exactly as they were, and a
 * second run over a database already at this version writes nothing.
 */
export const migrateStoreSchema: Effect.Effect<
  void,
  SqlError | StoreSchemaRefused,
  Client.SqlClient
> = Effect.gen(function* () {
  const sql = yield* Client.SqlClient;
  yield* sql.withTransaction(upgrade);
});

/**
 * {@link migrateStoreSchema} run where the store's own open still is: a
 * synchronous constructor that hands back a handle, not a fiber. Every
 * statement the migration issues is a synchronous call into `node:sqlite`, so
 * the run holds nothing and the layer's scope closes with it, and the refusal
 * is thrown as the error it already is.
 *
 * @deprecated A strangler shim on the `Effect.runSync` allowlist in
 * `docs/adr/0001-effect.md`. P5-11 makes the worker an Rpc server that opens
 * the store on its own runtime edge and runs {@link migrateStoreSchema}
 * there; this door goes with it.
 */
export function migrateStoreSchemaSync(client: Layer.Layer<Client.SqlClient>): void {
  const exit = Effect.runSyncExit(Effect.provide(migrateStoreSchema, client));
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
}
