import { fileURLToPath } from "node:url";
import type { EffectDrizzleQueryError, MigratorInitError } from "drizzle-orm/effect-core/errors";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import { Data, Effect } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { EFFECT_MIGRATION_FOLDERS } from "./effect-migration-folders.js";
import { Database } from "./query.js";

/**
 * The migration runner is Drizzle's own (`drizzle-orm/effect-postgres/migrator`):
 * it applies every folder under `migrations/` that its history table does not
 * name, in folder-name order, and records each by that name. A migration a
 * branch wrote before main's newer ones therefore still applies once the
 * branch lands, where a runner that kept only the highest id applied would
 * have stepped over it.
 *
 * What it adds is the one step Drizzle's docs have no need of: a database the
 * old `effect/sql` runner migrated keeps its history in `effect_sql_migrations`
 * under the old file tags, which Drizzle's migrator never reads, so before it
 * runs that history is copied into Drizzle's table once, under the folder each
 * tag moved to. It is what Drizzle's migrator would have written had it applied
 * those folders itself.
 *
 * The history table is Drizzle's own name in `public`, not its default
 * `drizzle` schema: `20261013123642_dead_tables_drop` drops that schema (an
 * earlier Drizzle runner's leftovers), and a fresh database's run is one
 * transaction, so under the default it would drop the table mid-run.
 */

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Drizzle's history table, in `public` for the reason above. */
export const DRIZZLE_MIGRATIONS = {
  SCHEMA: "public",
  TABLE: "__drizzle_migrations",
} as const;

/**
 * How long any statement of a run waits for a lock before it fails. Note
 * that the run is bounded, because it runs during the production build while
 * the deployment before it still serves: a DDL statement queued behind a
 * long transaction holds every query on that table behind it for as long as
 * it waits, so a statement blocked past this fails the build rather than
 * stalling the live traffic. A second run started while one is under way
 * fails the same way once it waits this long on the first.
 */
const MIGRATION_LOCK_TIMEOUT = "5s";

/** The old runner's history table, read once by the transfer and otherwise left alone. */
export const EFFECT_MIGRATIONS_TABLE = "effect_sql_migrations";

/** Each old tag's folder, as a lookup a recorded tag of any spelling can miss. */
const FOLDER_OF_TAG: ReadonlyMap<string, string> = new Map(
  Object.entries(EFFECT_MIGRATION_FOLDERS),
);

/** The migrations folder could not be read as Drizzle's migrator reads it. */
export class MigrationFolderUnreadable extends Data.TaggedError("MigrationFolderUnreadable")<{
  readonly folder: string;
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * The old runner recorded a migration this folder has no folder for, so the
 * transfer cannot say what Drizzle's table should hold, and nothing is run
 * over a history it would only guess at.
 */
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

/** The folder as Drizzle's migrator reads it: name, statements, hash, and the instant its name carries. */
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

/** The names Drizzle's table holds, none before the table exists. */
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

/**
 * Copies the old runner's history into Drizzle's table, once: only while
 * Drizzle's table is absent and the old one stands. The table is created
 * as Drizzle's migrator creates it, and each row is the one it would have
 * inserted for the folder (its hash, its millis, its name), stamped with
 * the instant the old runner applied it. One transaction, and a plain
 * `create table`, so two deploys transferring at once leave one history and
 * one failure rather than the rows twice.
 */
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

/**
 * Applies whatever the folder holds that the database has not recorded, and
 * answers the names applied, in the order they ran.
 */
export const runWebMigrations = /* @__PURE__ */ Effect.fn("web/runWebMigrations")(function* (
  folder: string = MIGRATIONS_FOLDER,
): Effect.fn.Return<ReadonlyArray<string>, MigrationError, Database | SqlClient.SqlClient> {
  const local = yield* readFolder(folder);
  const sql = yield* SqlClient.SqlClient;
  // The setting stands for the session, so the caller holds one connection for the whole run.
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
