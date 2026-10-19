import { pathToFileURL } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { waitingOutNeonComputeLimit } from "@luke/database/core/neon-compute-limit";
import { databaseOverPgClient } from "@luke/database/core/query";
import { POOL_LIMITS } from "@luke/service/db";
import { migrateDeploymentDatabase } from "@luke/service/maintenance/preview-database";
import { Config, Effect, Layer } from "effect";

/**
 * The unpooled URL, because the run is DDL in one long transaction, which
 * belongs on a session of its own rather than behind Neon's pooler. No lock
 * of our own, as Drizzle's docs run the migrator: a second run started while
 * the first is under way blocks on the first statement whose locks the two
 * share, and once the first commits it carries on over the history it read
 * before, failing on a statement the first already applied unless that
 * statement guards itself. Running one at a time is the deploy's to keep.
 */
const migrationConnectionString = Config.Redacted("DATABASE_URL_UNPOOLED");

const migrateConfiguredDatabase = Effect.gen(function* () {
  const url = yield* migrationConnectionString;
  // Note that the wait wraps the client's layer too, because Neon refuses the
  // compute as the connection opens, so each attempt needs a client of its own.
  yield* waitingOutNeonComputeLimit(
    // On a Preview, the step then switches off the work in flight its copy of
    // production holds; it runs here, on the direct connection, because Neon
    // puts bulk and admin work there rather than behind the pooler.
    migrateDeploymentDatabase(process.env).pipe(
      Effect.provide(
        Layer.provideMerge(
          databaseOverPgClient,
          PgClient.layer({ url, maxConnections: POOL_LIMITS.max }),
        ),
      ),
    ),
  );
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(migrateConfiguredDatabase);
}
