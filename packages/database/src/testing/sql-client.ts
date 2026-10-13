import { PgliteClient } from "@effect/sql-pglite";
import { PGlite } from "@electric-sql/pglite";
import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { Effect, Layer, ManagedRuntime } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { runWebMigrations } from "../core/migrator.js";
import { Database, type DatabaseServices } from "../core/query.js";
import { sqlClientOverUrl } from "../core/sql-client.js";
import { cloneStoreTestPostgres, STORE_TEST_DATABASE_ENVIRONMENT } from "./test-postgres.js";

/**
 * The `SqlClient` and Drizzle `Database` the store's own tests read, standing
 * over the same two dialects `hosted-store-database.ts` already chooses
 * between: PGlite in process by default, so `check.sh` needs no service, and
 * the Postgres named by `LUKE_STORE_TEST_DATABASE_URL` in the CI job that has
 * one. Either way a build of the layer is a database of its own: a fresh
 * PGlite, or a clone of the migrated Postgres dropped when the layer's scope
 * closes (`test-postgres.ts`), so a file's unscoped statement reaches no other
 * file's rows on either dialect. The Postgres half is the production layer's
 * own client and database; the PGlite half is `@effect/sql-pglite`'s client
 * and Drizzle's PGlite driver over it.
 */

/**
 * A `SqlClient` and the Drizzle `Database` over a PGlite the caller already
 * opened and still closes itself. `@effect/sql-pglite` serializes access to
 * the one connection PGlite is: a statement holds it for its own execution
 * and a transaction for its whole span, which is what a pool gives a
 * Postgres, so two concurrent transactions never nest their `BEGIN` and a
 * plain read of another fiber never lands inside whichever one is open.
 */
export const sqlClientOverPglite = (
  client: PGlite,
): Layer.Layer<SqlClient.SqlClient | PgliteClient.PgliteClient | Database, SqlError> =>
  Layer.provideMerge(
    Layer.effect(Database, PgliteDrizzle.makeWithDefaults()),
    PgliteClient.layerFrom(PgliteClient.fromClient({ liveClient: client })),
  );

/** A PGlite carrying the same generated migrations the store's tests run against. */
export async function openMigratedPglite(): Promise<PGlite> {
  const client = new PGlite();
  const migrationRuntime = ManagedRuntime.make(sqlClientOverPglite(client));
  try {
    await migrationRuntime.runPromise(runWebMigrations());
  } finally {
    await migrationRuntime.dispose();
  }
  return client;
}

function pgliteSqlClientOver(open: () => Promise<PGlite>) {
  return Layer.unwrap(
    Effect.map(
      Effect.acquireRelease(Effect.promise(open), (client) => Effect.promise(() => client.close())),
      sqlClientOverPglite,
    ),
  );
}

const pgliteSqlClient = pgliteSqlClientOver(openMigratedPglite);

/**
 * A PGlite with nothing applied to it, which is what a test of the migration
 * runner itself needs: the Postgres a CI run clones from has already been
 * migrated, so only an in-process database can stand in for a fresh one.
 */
export const unmigratedPgliteSqlClient: Layer.Layer<DatabaseServices, SqlError> =
  pgliteSqlClientOver(async () => new PGlite());

/**
 * The pool ends before the clone drops: the pool's finalizer is registered
 * after the clone's in the same scope, and finalizers run in reverse.
 */
function postgresSqlClient(connectionString: string) {
  return Layer.unwrap(
    Effect.map(
      Effect.acquireRelease(
        Effect.promise(() => cloneStoreTestPostgres(connectionString)),
        (clone) => Effect.promise(() => clone.drop()),
      ),
      (clone) => sqlClientOverUrl(clone.connectionString),
    ),
  );
}

const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];

/**
 * A database of the test's own, carrying every migration, over whichever
 * dialect this run was pointed at: lobehub's `getTestDB`, answered as the
 * layer a test provides rather than a handle it awaits, since every
 * statement here is an effect that reads its client and database from the
 * fiber.
 */
export const getTestDB = (): Layer.Layer<DatabaseServices, SqlError> =>
  connectionString === undefined ? pgliteSqlClient : postgresSqlClient(connectionString);
