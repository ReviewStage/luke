import { readFile, writeFile } from "node:fs/promises";
import { PgliteClient } from "@effect/sql-pglite";
import { PGlite } from "@electric-sql/pglite";
import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { Duration, Effect, Layer, ManagedRuntime, Redacted, Stream } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { runWebMigrations } from "../core/migrator.js";
import { Database, type DatabaseServices } from "../core/query.js";
import { sqlClientOverUrl } from "../core/sql-client.js";
import { SyncListener, syncListenerOverUrl, syncNotifyOver } from "../sync/listener.js";
import { SYNC_CHANNEL } from "../sync/notification.js";
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
 * and Drizzle's PGlite driver over it. Each carries a `SyncListener` on the
 * same database: on Postgres the production listener, on a connection of
 * its own beside the pool's one, and on PGlite the client's own listen.
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

/**
 * The variable naming the file a run's global setup dumped one migrated
 * PGlite to (`migrated-pglite-setup.ts`), read by every test file of the run.
 */
export const MIGRATED_PGLITE_ENVIRONMENT = {
  DUMP: "LUKE_MIGRATED_PGLITE_DUMP",
} as const;

/**
 * The data directory of a migrated PGlite, dumped once and loaded by every
 * later opening: the run's dump where its global setup named one, or else
 * the first PGlite this module migrated. A fresh PGlite spends seconds in
 * initdb and the migrations, a load from the dump a fraction of one, and a
 * file that opens a database per test opens dozens (workspaces-app's 45 spent
 * most of its run here).
 */
let migratedDataDirectory: Promise<Blob> | undefined;

async function migrateFreshPglite(): Promise<PGlite> {
  const client = new PGlite();
  const migrationRuntime = ManagedRuntime.make(sqlClientOverPglite(client));
  try {
    await migrationRuntime.runPromise(runWebMigrations());
  } catch (error) {
    await client.close();
    throw error;
  } finally {
    await migrationRuntime.dispose();
  }
  return client;
}

/**
 * Migrates a fresh PGlite and writes its dump to `file`, which a run's global
 * setup does once so that no test file migrates one of its own.
 */
export async function writeMigratedPgliteDump(file: string): Promise<void> {
  const client = await migrateFreshPglite();
  try {
    const dump = await client.dumpDataDir("none");
    await writeFile(file, new Uint8Array(await dump.arrayBuffer()));
  } finally {
    await client.close();
  }
}

/**
 * A PGlite of the caller's own carrying the same generated migrations the
 * store's tests run against. Note that where the run dumped none, the first
 * opening migrates and hands over that very database, dumped before anyone
 * writes to it, so a file that opens one database pays for no dump load on
 * top of its migrations.
 */
export async function openMigratedPglite(): Promise<PGlite> {
  const runDump = process.env[MIGRATED_PGLITE_ENVIRONMENT.DUMP];
  if (migratedDataDirectory === undefined && runDump !== undefined) {
    migratedDataDirectory = readFile(runDump).then((bytes) => new Blob([bytes]));
  }
  if (migratedDataDirectory !== undefined) {
    return new PGlite({ loadDataDir: await migratedDataDirectory });
  }
  const first = migrateFreshPglite();
  const dumped = first.then((client) => client.dumpDataDir("none"));
  migratedDataDirectory = dumped;
  try {
    await dumped;
  } catch (error) {
    // Note that we forget a failed dump, so a later opening migrates afresh rather than inheriting the failure.
    migratedDataDirectory = undefined;
    await first.then(
      (client) => client.close(),
      () => undefined,
    );
    throw error;
  }
  return first;
}

/**
 * A listener on the test's own PGlite, which `@effect/sql-pglite` listens on
 * in process. PGlite is one connection, so a notification through its client
 * is one on the listening connection.
 */
export const syncListenerOverPglite: Layer.Layer<SyncListener, never, PgliteClient.PgliteClient> =
  Layer.effect(
    SyncListener,
    Effect.map(PgliteClient.PgliteClient, (client) => ({
      listen: Effect.map(client.listen(SYNC_CHANNEL), (payloads) => ({
        payloads: Stream.fromQueue(payloads),
        notify: syncNotifyOver((statement, params) => client.unsafe(statement, params)),
      })),
    })),
  );

function pgliteSqlClientOver(open: () => Promise<PGlite>) {
  return Layer.unwrap(
    Effect.map(
      Effect.acquireRelease(Effect.promise(open), (client) => Effect.promise(() => client.close())),
      (client) => Layer.provideMerge(syncListenerOverPglite, sqlClientOverPglite(client)),
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
      (clone) =>
        Layer.merge(
          sqlClientOverUrl(clone.connectionString),
          // Note that the connect timeout is off, for the reason `sqlClientOverUrl` gives.
          syncListenerOverUrl({
            url: Redacted.make(clone.connectionString),
            connectTimeout: Duration.infinity,
          }),
        ),
    ),
  );
}

const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];

/**
 * A database of the test's own, carrying every migration, over whichever
 * dialect this run was pointed at: a `getTestDB`, answered as the
 * layer a test provides rather than a handle it awaits, since every
 * statement here is an effect that reads its client and database from the
 * fiber, with a `SyncListener` on that database.
 */
export const getTestDB = (): Layer.Layer<DatabaseServices | SyncListener, SqlError> =>
  connectionString === undefined ? pgliteSqlClient : postgresSqlClient(connectionString);
