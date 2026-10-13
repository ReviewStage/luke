import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_TABLE, runWebMigrations, webMigrations } from "@sidecar/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@sidecar/database/testing";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

interface RecordedMigration {
  readonly id: number;
  readonly name: string;
}

function withPlatform<A, E>(
  layer: Layer.Layer<A, E>,
): Layer.Layer<A | NodeServices.NodeServices, E> {
  return Layer.provideMerge(layer, NodeServices.layer);
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

/** A database of its own per test: `it.layer` would share one across the group. */
function onFreshDatabase<A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient | NodeServices.NodeServices>,
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
