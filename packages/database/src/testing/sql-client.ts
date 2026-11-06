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

export const sqlClientOverPglite = (
  client: PGlite,
): Layer.Layer<SqlClient.SqlClient | PgliteClient.PgliteClient | Database, SqlError> =>
  Layer.provideMerge(
    Layer.effect(Database, PgliteDrizzle.makeWithDefaults()),
    PgliteClient.layerFrom(PgliteClient.fromClient({ liveClient: client })),
  );

export const MIGRATED_PGLITE_ENVIRONMENT = {
  DUMP: "APP_MIGRATED_PGLITE_DUMP",
} as const;

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

export async function writeMigratedPgliteDump(file: string): Promise<void> {
  const client = await migrateFreshPglite();
  try {
    const dump = await client.dumpDataDir("none");
    await writeFile(file, new Uint8Array(await dump.arrayBuffer()));
  } finally {
    await client.close();
  }
}

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
    migratedDataDirectory = undefined;
    await first.then(
      (client) => client.close(),
      () => undefined,
    );
    throw error;
  }
  return first;
}

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

export const unmigratedPgliteSqlClient: Layer.Layer<DatabaseServices, SqlError> =
  pgliteSqlClientOver(async () => new PGlite());

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
          syncListenerOverUrl({
            url: Redacted.make(clone.connectionString),
            connectTimeout: Duration.infinity,
          }),
        ),
    ),
  );
}

const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];

export const getTestDB = (): Layer.Layer<DatabaseServices | SyncListener, SqlError> =>
  connectionString === undefined ? pgliteSqlClient : postgresSqlClient(connectionString);
