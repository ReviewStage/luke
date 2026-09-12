import { randomUUID } from "node:crypto";
import { NodeContext } from "@effect/platform-node";
import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Pool } from "pg";
import { runWebMigrations } from "../../server/db/effect-migrator";
import { sqlClientOverPool } from "../../server/db/sql-client";
import { payloadKeyRing } from "../../server/hosted/encryption";
import { type HostedStore, type HostedStoreRun, hostedStore } from "../../server/hosted/store";
import { STORE_TEST_DATABASE_ENVIRONMENT, sqlClientOverPglite } from "./sql-client";

/**
 * The store's tests run against the real generated migrations on a real
 * Postgres dialect: PGlite in process by default, so `check.sh` needs no
 * service, or the Postgres named by `LUKE_STORE_TEST_DATABASE_URL`, which the
 * CI job points at its service container after `db:migrate` has run there. A
 * PGlite is migrated here, through the same `runWebMigrations` the production
 * runner applies, because it is opened empty; a Postgres is not, because
 * `db:migrate` is the one runner that records what it applied.
 */
export interface HostedStoreTestDatabase {
  readonly store: HostedStore;
  /** The same client the store's effects run against, for a test that reads one itself. */
  readonly sql: Layer.Layer<SqlClient.SqlClient, SqlError>;
  /** The runner the store, the writers, and the speech module are handed here, over that client. */
  readonly run: HostedStoreRun;
  /** Inserts a user row for one test, answering the id every other row hangs from. */
  createUser(): Promise<string>;
  close(): Promise<void>;
}

export const TEST_PAYLOAD_SECRET = "c".repeat(64);

export async function openHostedStoreTestDatabase(): Promise<HostedStoreTestDatabase> {
  const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];
  const opened = connectionString ? await openNodePostgres(connectionString) : await openPglite();
  const keys = payloadKeyRing(TEST_PAYLOAD_SECRET);
  const runtime = ManagedRuntime.make(opened.sql);
  const run: HostedStoreRun = (effect) => runtime.runPromise(effect);
  return {
    sql: opened.sql,
    run,
    store: hostedStore({ keys, run }),
    createUser() {
      const id = `user-${randomUUID()}`;
      return run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            insert into "user" (id, name, email)
            values (${id}, ${"Test User"}, ${`${id}@luke.test`})
          `;
        }),
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
  close(): Promise<void>;
}

async function openPglite(): Promise<OpenedDatabase> {
  const client = new PGlite();
  const sql = sqlClientOverPglite(client);
  const migrationRuntime = ManagedRuntime.make(Layer.mergeAll(sql, NodeContext.layer));
  try {
    await migrationRuntime.runPromise(runWebMigrations());
  } finally {
    await migrationRuntime.dispose();
  }
  return { sql, close: () => client.close() };
}

/** Migrates nothing: `db:migrate` is what applies the migrations to a Postgres. */
async function openNodePostgres(connectionString: string): Promise<OpenedDatabase> {
  const pool = new Pool({ connectionString, max: 1 });
  return { sql: sqlClientOverPool(pool), close: () => pool.end() };
}
