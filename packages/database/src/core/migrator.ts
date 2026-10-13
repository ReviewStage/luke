import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

/**
 * The migration runner: the same SQL files Drizzle's runner applied, recorded
 * as `effect/unstable/sql` migrations. Nothing here rewrites a migration — the loader
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

const DRIZZLE_MIGRATIONS_FOLDER = fileURLToPath(new URL("../../migrations", import.meta.url));

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

const JOURNAL_PATH = ["meta", "_journal.json"] as const;

const JournalEntry = Schema.Struct({
  idx: Schema.Int,
  when: Schema.Number,
  tag: Schema.String,
});

const Journal = Schema.Struct({ entries: Schema.Array(JournalEntry) });

type JournalEntry = Schema.Schema.Type<typeof JournalEntry>;

const decodeJournal = Schema.decodeUnknownEffect(Schema.fromJsonString(Journal));

function failed(cause: unknown): Migrator.MigrationError {
  return new Migrator.MigrationError({
    cause,
    kind: "Failed",
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
const webMigrationJournal: (
  folder?: string,
) => Effect.Effect<ReadonlyArray<JournalEntry>, Migrator.MigrationError, FileSystem | Path> =
  /* @__PURE__ */ Effect.fn("web/webMigrationJournal")(function* (
    folder: string = DRIZZLE_MIGRATIONS_FOLDER,
  ) {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const journal = yield* decodeJournal(
      yield* fileSystem.readFileString(path.join(folder, ...JOURNAL_PATH)),
    );
    return journal.entries;
  }, Effect.mapError(failed));

function statementsOf(file: string): ReadonlyArray<string> {
  return file
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** The generated folder as migration records, in the journal's own order. */
export const webMigrations: (folder?: string) => Migrator.Loader<FileSystem | Path> =
  /* @__PURE__ */ Effect.fn("web/webMigrations")(function* (
    folder: string = DRIZZLE_MIGRATIONS_FOLDER,
  ) {
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

const migrate = Migrator.make({});

/** Applies whatever the generated folder still holds. */
export const runWebMigrations = /* @__PURE__ */ Effect.fn("web/runWebMigrations")(function* (
  folder: string = DRIZZLE_MIGRATIONS_FOLDER,
  table: string = MIGRATIONS_TABLE,
): Effect.fn.Return<
  ReadonlyArray<readonly [id: number, name: string]>,
  Migrator.MigrationError | SqlError,
  SqlClient.SqlClient | FileSystem | Path
> {
  return yield* migrate({ loader: webMigrations(folder), table });
});
