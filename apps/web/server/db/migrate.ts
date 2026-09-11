import { pathToFileURL } from "node:url";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import * as Migrator from "@effect/sql/Migrator";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Redacted } from "effect";
import { Client } from "pg";
import { runWebMigrations } from "./effect-migrator.js";
import { createPool } from "./index.js";

const MIGRATION_LOCK = {
  NAMESPACE: 1_280_654_853,
  RESOURCE: 1_146_243_418,
} as const;

type MigrationConnection = Pick<Client, "connect" | "query" | "end">;

function lockFailure(cause: unknown): Migrator.MigrationError {
  return new Migrator.MigrationError({
    cause,
    reason: "locked",
    message: "Could not hold the migration advisory lock",
  });
}

/**
 * Keeps same-branch deploys from applying the same migration concurrently. The
 * lock is a session's, so it stands on this one connection for as long as the
 * migration runs; the two finalizers close in reverse, which is what makes the
 * connection close even when the unlock itself fails.
 */
export function withMigrationLock<A, E, R>(
  connection: MigrationConnection,
  migrate: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Migrator.MigrationError, R> {
  return Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => connection.connect(), catch: lockFailure }),
      () => Effect.promise(() => connection.end()),
    );
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          connection.query("select pg_advisory_lock($1, $2)", [
            MIGRATION_LOCK.NAMESPACE,
            MIGRATION_LOCK.RESOURCE,
          ]),
        catch: lockFailure,
      }),
      () =>
        Effect.promise(() =>
          connection.query("select pg_advisory_unlock($1, $2)", [
            MIGRATION_LOCK.NAMESPACE,
            MIGRATION_LOCK.RESOURCE,
          ]),
        ),
    );
    return yield* migrate;
  }).pipe(Effect.scoped);
}

/**
 * The unpooled URL, because the migration holds one session's advisory lock and
 * a pooler is free to answer two statements on two sessions.
 */
const migrationConnectionString = Config.redacted("DATABASE_URL_UNPOOLED");

const migrateConfiguredDatabase = Effect.gen(function* () {
  const url = Redacted.value(yield* migrationConnectionString);
  const client = PgClient.layerFromPool({
    acquire: Effect.acquireRelease(
      Effect.sync(() => createPool(url)),
      (pool) => Effect.promise(() => pool.end()),
    ),
  });
  yield* withMigrationLock(new Client({ connectionString: url }), runWebMigrations()).pipe(
    Effect.provide(Layer.mergeAll(client, NodeContext.layer)),
  );
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(migrateConfiguredDatabase);
}
