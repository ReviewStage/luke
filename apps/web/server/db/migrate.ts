import { pathToFileURL } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { runWebMigrations } from "@luke/database/core/migrator";
import { databaseOverPgClient } from "@luke/database/core/query";
import { Config, Effect, Layer } from "effect";
import { POOL_LIMITS } from "./index.js";

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
  const applied = yield* runWebMigrations().pipe(
    Effect.provide(
      Layer.provideMerge(
        databaseOverPgClient,
        PgClient.layer({ url, maxConnections: POOL_LIMITS.max }),
      ),
    ),
  );
  yield* Effect.logInfo(`Applied ${applied.length} migrations`, applied);
});

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  NodeRuntime.runMain(migrateConfiguredDatabase);
}
