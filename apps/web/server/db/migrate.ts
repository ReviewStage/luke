import { pathToFileURL } from "node:url";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Redacted } from "effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import { Client } from "pg";
import { runWebMigrations } from "./effect-migrator.js";
import { POOL_LIMITS } from "./index.js";

const MIGRATION_LOCK = {
  NAMESPACE: 1_280_654_853,
  RESOURCE: 1_146_243_418,
} as const;

type MigrationConnection = Pick<Client, "connect" | "query" | "end">;

function lockFailure(cause: unknown): Migrator.MigrationError {
  return new Migrator.MigrationError({
    cause,
    kind: "Locked",
    message: "Could not hold the migration advisory lock",
  });
}

/**
 * A finalizer's step that is tolerated when it fails: the unlock, since the
 * advisory lock is the session's and goes with the connection, and the close,
 * since the connection is this process's and goes with it. Each is written
 * down and neither ends the scope's close, where a thrown promise would have
 * been a defect rather than the tolerance the finalizers promise.
 */
function tolerated<A>(what: string, step: () => Promise<A>): Effect.Effect<void> {
  return Effect.tryPromise(step).pipe(
    Effect.catch((failure) => Effect.logWarning(`${what}: ${failure.message}`)),
    Effect.asVoid,
  );
}

/**
 * Keeps same-branch deploys from applying the same migration concurrently. The
 * lock is a session's, so it stands on this one connection for as long as the
 * migration runs; the two finalizers close in reverse, which is what makes the
 * connection close even when the unlock itself fails.
 */
export const withMigrationLock = /* @__PURE__ */ Effect.fn("web/withMigrationLock")(function* <
  A,
  E,
  R,
>(connection: MigrationConnection, migrate: Effect.Effect<A, E, R>) {
  yield* Effect.acquireRelease(
    Effect.tryPromise({ try: () => connection.connect(), catch: lockFailure }),
    () => tolerated("The migration connection did not close", () => connection.end()),
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
      tolerated("The migration advisory lock was not released", () =>
        connection.query("select pg_advisory_unlock($1, $2)", [
          MIGRATION_LOCK.NAMESPACE,
          MIGRATION_LOCK.RESOURCE,
        ]),
      ),
  );
  return yield* migrate;
}, Effect.scoped);

/**
 * The unpooled URL, because the migration holds one session's advisory lock and
 * a pooler is free to answer two statements on two sessions.
 */
const migrationConnectionString = Config.Redacted("DATABASE_URL_UNPOOLED");

const migrateConfiguredDatabase = Effect.gen(function* () {
  const redacted = yield* migrationConnectionString;
  const url = Redacted.value(redacted);
  const client = PgClient.layer({ url: redacted, maxConnections: POOL_LIMITS.max });
  yield* withMigrationLock(new Client({ connectionString: url }), runWebMigrations()).pipe(
    Effect.provide(Layer.mergeAll(client, NodeServices.layer)),
  );
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(migrateConfiguredDatabase);
}
