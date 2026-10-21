import { pathToFileURL } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { runWebMigrations } from "@luke/database/core/migrator";
import { waitingOutNeonComputeLimit } from "@luke/database/core/neon-compute-limit";
import { databaseOverPgClient } from "@luke/database/core/query";
import { Config, Effect, Layer } from "effect";

/**
 * The unpooled URL, because the run is DDL in one long transaction, which
 * belongs on a session of its own rather than behind Neon's pooler. One
 * connection, held for the whole run, because the run bounds its lock waits
 * with a session setting (`MIGRATION_LOCK_TIMEOUT`), and Neon's proxy drops
 * one sent as a startup parameter, so it is set on the session itself and
 * must not be lost to a pool opening another. No lock of our own, as
 * Drizzle's docs run the migrator: a second run started while the first is
 * under way waits on the first statement whose locks the two share, and
 * fails the build once it has waited `MIGRATION_LOCK_TIMEOUT`, as any
 * statement blocked that long does. Running one at a time is the deploy's
 * to keep.
 */
const migrationConnectionString = Config.Redacted("DATABASE_URL_UNPOOLED");

const migrateConfiguredDatabase = Effect.gen(function* () {
  const url = yield* migrationConnectionString;
  // Note that the wait wraps the client's layer too, because Neon refuses the
  // compute as the connection opens, so each attempt needs a client of its own.
  const applied = yield* waitingOutNeonComputeLimit(
    runWebMigrations().pipe(
      Effect.provide(
        Layer.provideMerge(databaseOverPgClient, PgClient.layerFrom(PgClient.makeClient({ url }))),
      ),
    ),
  );
  yield* Effect.logInfo(`Applied ${applied.length} migrations`, applied);
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(migrateConfiguredDatabase);
}
