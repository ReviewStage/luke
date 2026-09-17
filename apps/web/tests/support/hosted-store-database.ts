import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { user } from "../../server/db/auth-schema";
import { runWebMigrations } from "../../server/db/effect-migrator";
import { db } from "../../server/db/query";
import { sqlClientOverUrl } from "../../server/db/sql-client";
import { payloadKeyRing } from "../../server/hosted/encryption";
import { type HostedStore, hostedStore } from "../../server/hosted/store";
import { sqlClientOverPglite } from "./sql-client";
import { cloneStoreTestPostgres, STORE_TEST_DATABASE_ENVIRONMENT } from "./store-test-postgres";

/**
 * The store's tests run against the real generated migrations on a real
 * Postgres dialect: PGlite in process by default, so `check.sh` needs no
 * service, or the Postgres named by `LUKE_STORE_TEST_DATABASE_URL`, which the
 * CI job points at its service container after `db:migrate` has run there. A
 * PGlite is migrated here, through the same `runWebMigrations` the production
 * runner applies, because it is opened empty; a Postgres is not, because
 * `db:migrate` is the one runner that records what it applied. Each opening
 * is a database of its own on either dialect: a fresh PGlite, or a clone of
 * the migrated Postgres that `close` drops (`store-test-postgres.ts`), so a
 * statement one file forgets to scope reaches no other file's rows.
 */
/**
 * The suite's own edge: the runner a test answers the store's effects
 * through, over the runtime this harness opened for the test database.
 */
export type HostedStoreTestRun = <A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
) => Promise<A>;

interface HostedStoreTestDatabase {
  readonly store: HostedStore;
  /** The same client the store's effects run against, for a test that reads one itself. */
  readonly sql: Layer.Layer<SqlClient.SqlClient, SqlError>;
  /** The runner a test answers the store's and the writers' effects through, over that client. */
  readonly run: HostedStoreTestRun;
  /**
   * A second connection to the same database, for a test of two transactions
   * contending for one row; none on PGlite, which is one connection and runs
   * two transactions one after the other whatever the test forks.
   */
  readonly anotherConnection: (() => Layer.Layer<SqlClient.SqlClient, SqlError>) | undefined;
  /** Inserts a user row for one test, answering the id every other row hangs from. */
  createUser(): Promise<string>;
  close(): Promise<void>;
}

export const TEST_PAYLOAD_SECRET = Redacted.make("c".repeat(64));

/** What every test user is called; the column is not null and no test reads it. */
export const TEST_USER_NAME = "Test User";

export async function openHostedStoreTestDatabase(): Promise<HostedStoreTestDatabase> {
  const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];
  const opened = connectionString ? await openNodePostgres(connectionString) : await openPglite();
  const keys = payloadKeyRing(TEST_PAYLOAD_SECRET);
  const runtime = ManagedRuntime.make(opened.sql);
  const run: HostedStoreTestRun = (effect) => runtime.runPromise(effect);
  return {
    sql: opened.sql,
    run,
    anotherConnection: opened.anotherConnection,
    store: hostedStore({ keys }),
    createUser() {
      const id = `user-${randomUUID()}`;
      return run(
        Effect.asVoid(
          db.insert(user).values({ id, name: TEST_USER_NAME, email: `${id}@luke.test` }),
        ),
      ).then(() => id);
    },
    async close() {
      await runtime.dispose();
      await opened.close();
    },
  };
}

interface OpenedDatabase {
  readonly sql: Layer.Layer<SqlClient.SqlClient, SqlError>;
  readonly anotherConnection: HostedStoreTestDatabase["anotherConnection"];
  close(): Promise<void>;
}

async function openPglite(): Promise<OpenedDatabase> {
  const client = new PGlite();
  const sql = sqlClientOverPglite(client);
  const migrationRuntime = ManagedRuntime.make(Layer.mergeAll(sql, NodeServices.layer));
  try {
    await migrationRuntime.runPromise(runWebMigrations());
  } finally {
    await migrationRuntime.dispose();
  }
  return { sql, anotherConnection: undefined, close: () => client.close() };
}

/** Migrates nothing: `db:migrate` is what applies the migrations to the Postgres this clones. */
async function openNodePostgres(connectionString: string): Promise<OpenedDatabase> {
  const clone = await cloneStoreTestPostgres(connectionString);
  return {
    sql: sqlClientOverUrl(clone.connectionString),
    anotherConnection: () => sqlClientOverUrl(clone.connectionString),
    // The client's own pool goes with the runtime the caller disposes before
    // this runs, so all that is left to end here is the clone itself; a
    // second connection a test opened is that test's to dispose.
    close: () => clone.drop(),
  };
}
