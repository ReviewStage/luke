import { fileURLToPath } from "node:url";
import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform/Path";
import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Schema } from "effect";

/**
 * The migration runner: the same SQL files Drizzle's runner applied, recorded
 * as `@effect/sql` migrations. Nothing here rewrites a migration — the loader
 * reads the generated folder and its journal, so the statements and their order
 * are Drizzle's own, and the only thing that changes is which table says which
 * of them a database has seen.
 *
 * `Migrator.make` rather than `PgMigrator.run`, which is that same runner
 * wrapped in a `pg_dump` of the schema: this build dumps nothing, and the
 * narrower runner needs only a `SqlClient`, so the store's tests can run it on
 * either dialect they stand over.
 */

export const MIGRATIONS_TABLE = "effect_sql_migrations";

/** Where Drizzle's own runner recorded what it had applied. */
export const DRIZZLE_MIGRATIONS_TABLE = {
  SCHEMA: "drizzle",
  NAME: "__drizzle_migrations",
} as const;

const DRIZZLE_MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

const JOURNAL_PATH = ["meta", "_journal.json"] as const;

const JournalEntry = Schema.Struct({
  idx: Schema.Int,
  when: Schema.Number,
  tag: Schema.String,
});

const Journal = Schema.Struct({ entries: Schema.Array(JournalEntry) });

export type JournalEntry = Schema.Schema.Type<typeof JournalEntry>;

const decodeJournal = Schema.decodeUnknown(Schema.parseJson(Journal));

/** The latest instant Drizzle's history carries, as its journal wrote it. */
const DrizzleHistoryRow = Schema.Struct({
  latest: Schema.Union(Schema.NumberFromString, Schema.Null),
});

const decodeHistoryRow = Schema.decodeUnknown(DrizzleHistoryRow);

const MigrationCountRow = Schema.Struct({ recorded: Schema.Int });

const decodeCountRow = Schema.decodeUnknown(MigrationCountRow);

function failed(cause: unknown): Migrator.MigrationError {
  return new Migrator.MigrationError({
    cause,
    reason: "failed",
    message: "Could not read the generated migrations",
  });
}

/**
 * A migration's id is its journal index plus one, because the runner reads a
 * database with no history as standing at id zero.
 */
function migrationId(entry: JournalEntry): number {
  return entry.idx + 1;
}

/** The generated folder journal: the order and the instants Drizzle stamped. */
export function webMigrationJournal(
  folder: string = DRIZZLE_MIGRATIONS_FOLDER,
): Effect.Effect<ReadonlyArray<JournalEntry>, Migrator.MigrationError, FileSystem | Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const journal = yield* decodeJournal(
      yield* fileSystem.readFileString(path.join(folder, ...JOURNAL_PATH)),
    );
    return journal.entries;
  }).pipe(Effect.mapError(failed));
}

function statementsOf(file: string): ReadonlyArray<string> {
  return file
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** The generated folder as migration records, in the journal's own order. */
export function webMigrations(
  folder: string = DRIZZLE_MIGRATIONS_FOLDER,
): Migrator.Loader<FileSystem | Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const entries = yield* webMigrationJournal(folder);
    return yield* Effect.forEach(entries, (entry) =>
      fileSystem.readFileString(path.join(folder, `${entry.tag}.sql`)).pipe(
        Effect.mapError(failed),
        Effect.map((file): Migrator.ResolvedMigration => {
          const statements = statementsOf(file);
          return [
            migrationId(entry),
            entry.tag,
            Effect.succeed(
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                yield* Effect.forEach(statements, (statement) => sql.unsafe(statement), {
                  discard: true,
                });
              }),
            ),
          ];
        }),
      ),
    );
  });
}

const migrate = Migrator.make({});

/** Creates the bookkeeping table without applying anything. */
function ensureMigrationsTable(table: string) {
  return Effect.asVoid(migrate({ loader: Effect.succeed([]), table }));
}

/**
 * Copies Drizzle's history into the runner's own table, once, so a database
 * Drizzle already migrated is not migrated again.
 *
 * Drizzle stamped each row it wrote with the journal instant of the migration
 * it had just applied, and refused anything at or below the greatest instant it
 * found, so that greatest instant is the whole of what its history says: every
 * journal entry at or below it has been applied, and nothing above it has. The
 * copy runs only into an empty table, which is what makes a second launch a
 * no-op rather than a second copy.
 */
export function bootstrapFromDrizzleHistory(
  folder: string = DRIZZLE_MIGRATIONS_FOLDER,
  table: string = MIGRATIONS_TABLE,
): Effect.Effect<
  ReadonlyArray<readonly [id: number, name: string]>,
  Migrator.MigrationError | SqlError,
  SqlClient.SqlClient | FileSystem | Path
> {
  return Effect.gen(function* () {
    yield* ensureMigrationsTable(table);
    const sql = yield* SqlClient.SqlClient;
    const present = yield* sql`
      select 1 as present from information_schema.tables
      where table_schema = ${DRIZZLE_MIGRATIONS_TABLE.SCHEMA}
        and table_name = ${DRIZZLE_MIGRATIONS_TABLE.NAME}
    `.withoutTransform;
    if (present.length === 0) {
      return [];
    }
    const recorded = yield* decodeCountRow(
      (yield* sql`select count(*)::int as recorded from ${sql(table)}`.withoutTransform)[0],
    ).pipe(Effect.mapError(failed));
    if (recorded.recorded > 0) {
      return [];
    }
    const history = yield* decodeHistoryRow(
      (yield* sql`
        select max(created_at)::text as latest
        from ${sql(DRIZZLE_MIGRATIONS_TABLE.SCHEMA)}.${sql(DRIZZLE_MIGRATIONS_TABLE.NAME)}
      `.withoutTransform)[0],
    ).pipe(Effect.mapError(failed));
    const latest = history.latest;
    if (latest === null) {
      return [];
    }
    const applied = (yield* webMigrationJournal(folder))
      .filter((entry) => entry.when <= latest)
      .map((entry) => [migrationId(entry), entry.tag] as const);
    if (applied.length === 0) {
      return [];
    }
    yield* sql`
      insert into ${sql(table)} ${sql.insert(
        applied.map(([migration_id, name]) => ({ migration_id, name })),
      )}
    `.withoutTransform;
    return applied;
  });
}

/** Bootstraps, then applies whatever the generated folder still holds. */
export function runWebMigrations(
  folder: string = DRIZZLE_MIGRATIONS_FOLDER,
  table: string = MIGRATIONS_TABLE,
): Effect.Effect<
  ReadonlyArray<readonly [id: number, name: string]>,
  Migrator.MigrationError | SqlError,
  SqlClient.SqlClient | FileSystem | Path
> {
  return Effect.gen(function* () {
    yield* bootstrapFromDrizzleHistory(folder, table);
    return yield* migrate({ loader: webMigrations(folder), table });
  });
}
