import { pathToFileURL } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { runWebMigrations } from "@repo/database/core/migrator";
import { waitingOutNeonComputeLimit } from "@repo/database/core/neon-compute-limit";
import { databaseOverPgClient } from "@repo/database/core/query";
import { Config, Effect, Layer } from "effect";

const migrationConnectionString = Config.Redacted("DATABASE_URL_UNPOOLED");

const migrateConfiguredDatabase = Effect.gen(function* () {
  const url = yield* migrationConnectionString;
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
