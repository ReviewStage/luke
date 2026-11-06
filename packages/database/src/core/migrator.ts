import { fileURLToPath } from "node:url";
import type { EffectDrizzleQueryError, MigratorInitError } from "drizzle-orm/effect-core/errors";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import { Data, Effect } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { EFFECT_MIGRATION_FOLDERS } from "./effect-migration-folders.js";
import { Database } from "./query.js";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../migrations", import.meta.url));

export const DRIZZLE_MIGRATIONS = {
  SCHEMA: "public",
  TABLE: "__drizzle_migrations",
} as const;

const MIGRATION_LOCK_TIMEOUT = "5s";

export const EFFECT_MIGRATIONS_TABLE = "effect_sql_migrations";

const FOLDER_OF_TAG: ReadonlyMap<string, string> = new Map(
  Object.entries(EFFECT_MIGRATION_FOLDERS),
);

export class MigrationFolderUnreadable extends Data.TaggedError("MigrationFolderUnreadable")<{
  readonly folder: string;
  readonly cause: unknown;
  readonly message: string;
}> {}

export class MigrationHistoryUnmapped extends Data.TaggedError("MigrationHistoryUnmapped")<{
  readonly tags: ReadonlyArray<string>;
  readonly message: string;
}> {}

export type MigrationError =
  | MigrationFolderUnreadable
  | MigrationHistoryUnmapped
  | MigratorInitError
  | EffectDrizzleQueryError
  | SqlError;

interface RecordedRow {
  readonly name: string | null;
}

function readFolder(
  folder: string,
): Effect.Effect<ReadonlyArray<MigrationMeta>, MigrationFolderUnreadable> {
  return Effect.try({
    try: () => readMigrationFiles({ migrationsFolder: folder }),
    catch: (cause) =>
      new MigrationFolderUnreadable({
        folder,
        cause,
        message: `Could not read the migrations in ${folder}`,
      }),
  });
}

const tableExists = (schema: string | undefined, table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql`
      select 1 from information_schema.tables
      where table_schema = ${schema ?? sql.literal("current_schema()")} and table_name = ${table}
    `;
    return rows.length > 0;
  });

const recordedNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* tableExists(DRIZZLE_MIGRATIONS.SCHEMA, DRIZZLE_MIGRATIONS.TABLE))) {
    return new Set<string>();
  }
  const rows = yield* sql<RecordedRow>`
    select name from ${sql(DRIZZLE_MIGRATIONS.SCHEMA)}.${sql(DRIZZLE_MIGRATIONS.TABLE)}
  `;
  return new Set(rows.flatMap((row) => (row.name === null ? [] : [row.name])));
});

const transferHistory = Effect.fn("web/transferHistory")(
  function* (local: ReadonlyArray<MigrationMeta>) {
    const sql = yield* SqlClient.SqlClient;
    if (yield* tableExists(DRIZZLE_MIGRATIONS.SCHEMA, DRIZZLE_MIGRATIONS.TABLE)) return;
    if (!(yield* tableExists(undefined, EFFECT_MIGRATIONS_TABLE))) return;
    const byFolder = new Map(local.map((migration) => [migration.name, migration]));
    const recorded = yield* sql<{ readonly name: string }>`
      select name from ${sql(EFFECT_MIGRATIONS_TABLE)} order by migration_id
    `;
    const transfers = recorded.map(({ name: tag }) => ({
      tag,
      migration: byFolder.get(FOLDER_OF_TAG.get(tag) ?? ""),
    }));
    const unmapped = transfers.flatMap(({ tag, migration }) => (migration ? [] : [tag]));
    if (unmapped.length > 0) {
      return yield* new MigrationHistoryUnmapped({
        tags: unmapped,
        message: `${EFFECT_MIGRATIONS_TABLE} records migrations with no folder in this build: ${unmapped.join(", ")}`,
      });
    }
    const table = sql`${sql(DRIZZLE_MIGRATIONS.SCHEMA)}.${sql(DRIZZLE_MIGRATIONS.TABLE)}`;
    yield* sql`create schema if not exists ${sql(DRIZZLE_MIGRATIONS.SCHEMA)}`;
    yield* sql`
      create table ${table} (
        id serial primary key,
        hash text not null,
        created_at bigint,
        name text,
        applied_at timestamp with time zone default now()
      )
    `;
    yield* Effect.forEach(
      transfers.flatMap(({ tag, migration }) => (migration ? [{ tag, migration }] : [])),
      ({ tag, migration }) => sql`
        insert into ${table} (hash, created_at, name, applied_at)
        select ${migration.hash}, ${migration.folderMillis}, ${migration.name}, created_at
        from ${sql(EFFECT_MIGRATIONS_TABLE)} where name = ${tag}
      `,
      { discard: true },
    );
  },
  (transfer) => Effect.flatMap(SqlClient.SqlClient, (sql) => sql.withTransaction(transfer)),
);

export const runWebMigrations = Effect.fn("web/runWebMigrations")(function* (
  folder: string = MIGRATIONS_FOLDER,
): Effect.fn.Return<ReadonlyArray<string>, MigrationError, Database | SqlClient.SqlClient> {
  const local = yield* readFolder(folder);
  const sql = yield* SqlClient.SqlClient;
  yield* sql`select set_config('lock_timeout', ${MIGRATION_LOCK_TIMEOUT}, false)`;
  yield* transferHistory(local);
  const before = yield* recordedNames;
  const db = yield* Database;
  yield* migrate(db, {
    migrationsFolder: folder,
    migrationsSchema: DRIZZLE_MIGRATIONS.SCHEMA,
    migrationsTable: DRIZZLE_MIGRATIONS.TABLE,
  });
  const after = yield* recordedNames;
  return local
    .map((migration) => migration.name)
    .filter((name) => after.has(name) && !before.has(name));
});
