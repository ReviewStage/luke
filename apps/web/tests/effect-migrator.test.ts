import assert from "node:assert/strict";
import { NodeContext } from "@effect/platform-node";
import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  bootstrapFromDrizzleHistory,
  DRIZZLE_MIGRATIONS_TABLE,
  MIGRATIONS_TABLE,
  runWebMigrations,
  webMigrationJournal,
  webMigrations,
} from "../server/db/effect-migrator.js";
import {
  drizzleMigratedPgliteSqlClient,
  testSqlClient,
  unmigratedPgliteSqlClient,
} from "./support/sql-client.js";

interface RecordedMigration {
  readonly id: number;
  readonly name: string;
}

interface Column {
  readonly table: string;
  readonly column: string;
  readonly type: string;
  readonly nullable: string;
}

function withPlatform<A, E>(layer: Layer.Layer<A, E>): Layer.Layer<A | NodeContext.NodeContext, E> {
  return Layer.provideMerge(layer, NodeContext.layer);
}

const recorded = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`select migration_id, name from ${sql(MIGRATIONS_TABLE)} order by migration_id`
    .withoutTransform;
  return rows.map((row): RecordedMigration => ({ id: row.migration_id, name: row.name }));
});

const named = (
  migrations: ReadonlyArray<readonly [id: number, name: string]>,
): ReadonlyArray<RecordedMigration> => migrations.map(([id, name]) => ({ id, name }));

const resolved = Effect.map(webMigrations(), (migrations) =>
  named(migrations.map(([id, name]) => [id, name])),
);

/**
 * Every column of every table the migrations left behind, bookkeeping aside:
 * the runner's own table is what this migration introduces, so it is the one
 * difference expected between the two runners' schemas.
 */
const publicColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly table_name: string;
    readonly column_name: string;
    readonly data_type: string;
    readonly is_nullable: string;
  }>`
    select table_name, column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name <> ${MIGRATIONS_TABLE}
    order by table_name, column_name
  `.withoutTransform;
  return rows.map(
    (row): Column => ({
      table: row.table_name,
      column: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable,
    }),
  );
});

function seedDrizzleHistory(createdAt: number) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const schema = sql(DRIZZLE_MIGRATIONS_TABLE.SCHEMA);
    const table = sql(DRIZZLE_MIGRATIONS_TABLE.NAME);
    yield* sql`create schema ${schema}`;
    yield* sql`
      create table ${schema}.${table} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `;
    yield* sql`
      insert into ${schema}.${table} (hash, created_at)
      values (${"seeded"}, ${createdAt})
    `;
  });
}

it.layer(withPlatform(testSqlClient))(
  "the web migration runner over a database already at the latest migration",
  (it) => {
    it.effect("applies nothing, and records every migration the folder holds", () =>
      Effect.gen(function* () {
        assert.deepEqual(named(yield* runWebMigrations()), []);
        assert.deepEqual(yield* recorded, yield* resolved);
      }),
    );

    it.effect("applies nothing a second time either", () =>
      Effect.gen(function* () {
        yield* runWebMigrations();
        assert.deepEqual(named(yield* runWebMigrations()), []);
        assert.deepEqual(yield* recorded, yield* resolved);
      }),
    );
  },
);

/** A database of its own per test: `it.layer` would share one across the group. */
function onFreshDatabase<A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient | NodeContext.NodeContext>,
): Effect.Effect<A, E | SqlError> {
  return Effect.provide(effect, withPlatform(unmigratedPgliteSqlClient));
}

it.effect("a fresh database takes every migration the folder holds, in the journal's order", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      assert.deepEqual(named(yield* runWebMigrations()), yield* resolved);
      assert.deepEqual(yield* recorded, yield* resolved);
    }),
  ),
);

it.effect("the bootstrap records only the migrations Drizzle's history says were applied", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      const boundary = 3;
      const entry = (yield* webMigrationJournal())[boundary];
      assert.ok(entry);
      const applied = (yield* resolved).slice(0, boundary + 1);
      yield* seedDrizzleHistory(entry.when);
      assert.deepEqual(named(yield* bootstrapFromDrizzleHistory()), applied);
      assert.deepEqual(yield* recorded, applied);
    }),
  ),
);

it.effect("the bootstrap records nothing when there is no Drizzle history to read", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      assert.deepEqual(named(yield* bootstrapFromDrizzleHistory()), []);
      assert.deepEqual(yield* recorded, []);
    }),
  ),
);

it.effect("the two runners leave a fresh database with the same schema", () =>
  Effect.gen(function* () {
    const drizzled = yield* Effect.provide(
      publicColumns,
      withPlatform(drizzleMigratedPgliteSqlClient),
    );
    const migrated = yield* onFreshDatabase(Effect.zipRight(runWebMigrations(), publicColumns));
    assert.deepEqual(migrated, drizzled);
  }),
);
