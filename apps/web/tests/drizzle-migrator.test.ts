import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { EFFECT_MIGRATION_FOLDERS } from "@repo/database/core/effect-migration-folders";
import {
  DRIZZLE_MIGRATIONS,
  EFFECT_MIGRATIONS_TABLE,
  MIGRATIONS_FOLDER,
  MigrationHistoryUnmapped,
  runWebMigrations,
} from "@repo/database/core/migrator";
import { getTestDB, unmigratedPgliteSqlClient } from "@repo/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

interface RecordedMigration {
  readonly hash: string;
  readonly created_at: string;
  readonly name: string;
}

const recorded = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<RecordedMigration>`
    select hash, created_at::text as created_at, name
    from ${sql(DRIZZLE_MIGRATIONS.SCHEMA)}.${sql(DRIZZLE_MIGRATIONS.TABLE)} order by id
  `.withoutTransform;
  return rows.map(({ hash, created_at, name }) => ({ hash, created_at, name }));
});

const recordedNames = Effect.map(recorded, (rows) => rows.map((row) => row.name));

const tableNamed = (schema: string, table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql`
      select 1 from information_schema.tables where table_schema = ${schema} and table_name = ${table}
    `;
    return rows.length > 0;
  });

const folders = Effect.promise(async () =>
  (await readdir(MIGRATIONS_FOLDER)).sort((left, right) => left.localeCompare(right)),
);

function withPlatform<A, E>(
  layer: Layer.Layer<A, E>,
): Layer.Layer<A | NodeServices.NodeServices, E> {
  return Layer.provideMerge(layer, NodeServices.layer);
}

function onFreshDatabase<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.provide(effect, withPlatform(unmigratedPgliteSqlClient));
}

function migrateAsTheOldRunner(
  migrations: ReadonlyArray<readonly [tag: string, statements: ReadonlyArray<string>]>,
) {
  const loader: Migrator.Loader = Effect.succeed(
    migrations.map(
      ([tag, statements], index): Migrator.ResolvedMigration => [
        index + 1,
        tag,
        Effect.succeed(
          Effect.flatMap(SqlClient.SqlClient, (sql) =>
            Effect.forEach(statements, (statement) => sql.unsafe(statement), { discard: true }),
          ),
        ),
      ],
    ),
  );
  return Migrator.make({})({ loader, table: EFFECT_MIGRATIONS_TABLE });
}

const oldRunnerMigrations = Effect.promise(() =>
  Promise.all(
    Object.entries(EFFECT_MIGRATION_FOLDERS).map(async ([tag, folder]) => {
      const file = await readFile(join(MIGRATIONS_FOLDER, folder, "migration.sql"), "utf8");
      const statements = file
        .split(STATEMENT_BREAKPOINT)
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      return [tag, statements] as const;
    }),
  ),
);

it.layer(withPlatform(getTestDB()))(
  "the web migration runner over a database already at the latest migration",
  (it) => {
    it.effect("applies nothing, and has recorded every folder by name", () =>
      Effect.gen(function* () {
        assert.deepEqual(yield* runWebMigrations(), []);
        assert.deepEqual([...(yield* recordedNames)].sort(), yield* folders);
      }),
    );
  },
);

it.effect("a fresh database takes every folder, in name order", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      const all = yield* folders;
      assert.deepEqual(yield* runWebMigrations(), all);
      assert.deepEqual(yield* recordedNames, all);
    }),
  ),
);

const syntheticMigrationsFolder = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "migrations-" });
  const write = (name: string) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.join(folder, name));
      yield* fileSystem.writeFileString(
        path.join(folder, name, "migration.sql"),
        `create table "${name}" (id integer primary key)`,
      );
    });
  return { folder, write };
});

const FIRST = "20260101000000_first";
const SECOND = "20260102000000_second";
const THIRD = "20260103000000_third";

it.effect(
  "a run leaves its session's lock_timeout at five seconds, so a DDL statement blocked by live traffic fails the build rather than stalling the traffic queued behind it",
  () =>
    onFreshDatabase(
      Effect.scoped(
        Effect.gen(function* () {
          const { folder, write } = yield* syntheticMigrationsFolder;
          yield* write(FIRST);
          assert.deepEqual(yield* runWebMigrations(folder), [FIRST]);
          const sql = yield* SqlClient.SqlClient;
          const [setting] = yield* sql<{ readonly timeout: string }>`
            select current_setting('lock_timeout') as timeout
          `;
          assert.equal(setting?.timeout, "5s");
        }),
      ),
    ),
);

it.effect(
  "a migration named before the latest one applied, landing after it, is applied rather than stepped over",
  () =>
    onFreshDatabase(
      Effect.scoped(
        Effect.gen(function* () {
          const { folder, write } = yield* syntheticMigrationsFolder;
          yield* write(FIRST);
          yield* write(THIRD);
          assert.deepEqual(yield* runWebMigrations(folder), [FIRST, THIRD]);

          yield* write(SECOND);
          assert.deepEqual(yield* runWebMigrations(folder), [SECOND]);
          assert.ok(yield* tableNamed("public", SECOND));
          assert.deepEqual(yield* recordedNames, [FIRST, THIRD, SECOND]);
          assert.deepEqual(yield* runWebMigrations(folder), []);
        }),
      ),
    ),
);

it.effect(
  "a database the old runner migrated re-runs nothing it ran, applies only what was written after the move, and holds the history Drizzle's migrator would have written",
  () =>
    Effect.gen(function* () {
      const fromScratch = yield* onFreshDatabase(Effect.andThen(runWebMigrations(), recorded));
      const moved = new Set<string>(Object.values(EFFECT_MIGRATION_FOLDERS));
      const writtenSince = (yield* folders).filter((folder) => !moved.has(folder));
      yield* onFreshDatabase(
        Effect.gen(function* () {
          yield* migrateAsTheOldRunner(yield* oldRunnerMigrations);
          assert.ok(!(yield* tableNamed(DRIZZLE_MIGRATIONS.SCHEMA, DRIZZLE_MIGRATIONS.TABLE)));

          assert.deepEqual(yield* runWebMigrations(), writtenSince);
          assert.deepEqual(yield* recorded, fromScratch);
          assert.deepEqual(yield* runWebMigrations(), []);
        }),
      );
    }),
);

it.effect(
  "a tag the old runner recorded with no folder fails the run naming it, and leaves Drizzle's history unwritten",
  () =>
    onFreshDatabase(
      Effect.gen(function* () {
        const [first] = yield* oldRunnerMigrations;
        assert.ok(first);
        const lost = "0999_lost_on_another_branch";
        yield* migrateAsTheOldRunner([first, [lost, []]]);

        const failure = yield* Effect.flip(runWebMigrations());
        assert.ok(failure instanceof MigrationHistoryUnmapped);
        assert.deepEqual(failure.tags, [lost]);
        assert.match(failure.message, new RegExp(lost));
        assert.ok(!(yield* tableNamed(DRIZZLE_MIGRATIONS.SCHEMA, DRIZZLE_MIGRATIONS.TABLE)));
      }),
    ),
);
