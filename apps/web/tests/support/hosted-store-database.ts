import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { type Layer, ManagedRuntime } from "effect";
import { Pool } from "pg";
import { DRIZZLE_MIGRATIONS_FOLDER } from "../../server/db/effect-migrator";
import * as schema from "../../server/db/schema";
import { sqlClientOverPool } from "../../server/db/sql-client";
import { payloadKeyRing } from "../../server/hosted/encryption";
import { type HostedStore, type HostedStoreDatabase, hostedStore } from "../../server/hosted/store";
import { STORE_TEST_DATABASE_ENVIRONMENT, sqlClientOverPglite } from "./sql-client";

/**
 * The store's tests run against the real generated migrations on a real
 * Postgres dialect: PGlite in process by default, so `check.sh` needs no
 * service, or the Postgres named by `LUKE_STORE_TEST_DATABASE_URL`, which the
 * CI job points at its service container after `db:migrate` has run there. A
 * PGlite is migrated here, because it is opened empty; a Postgres is not,
 * because `db:migrate` is the one runner that records what it applied.
 *
 * One database, read through both halves of the store's migration: the Drizzle
 * handle the modules still on it take, and a `SqlClient` over the very same
 * connection for the modules on `@effect/sql`, so a row a test writes through
 * one is the row the other reads. The runtime over that client is the store's
 * `run` seam here, the way `runWeb` is in a function.
 */

export const TEST_PAYLOAD_SECRET = "c".repeat(64);

export interface HostedStoreTestDatabase {
  readonly db: HostedStoreDatabase;
  readonly store: HostedStore;
  /** The same client the store's effects run against, for a test that reads one itself. */
  readonly sql: Layer.Layer<SqlClient.SqlClient, SqlError>;
  /** Inserts a user row for one test, answering the id every other row hangs from. */
  createUser(): Promise<string>;
  close(): Promise<void>;
}

export async function openHostedStoreTestDatabase(): Promise<HostedStoreTestDatabase> {
  const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];
  const opened = connectionString ? await openNodePostgres(connectionString) : await openPglite();
  const keys = payloadKeyRing(TEST_PAYLOAD_SECRET);
  const runtime = ManagedRuntime.make(opened.sql);
  return {
    db: opened.db,
    sql: opened.sql,
    store: hostedStore({ db: opened.db, keys, run: (effect) => runtime.runPromise(effect) }),
    async createUser() {
      const id = `user-${randomUUID()}`;
      await opened.db.insert(schema.user).values({
        id,
        name: "Test User",
        email: `${id}@luke.test`,
      });
      return id;
    },
    async close() {
      await runtime.dispose();
      await opened.close();
    },
  };
}

interface OpenedDatabase {
  readonly db: HostedStoreDatabase;
  readonly sql: Layer.Layer<SqlClient.SqlClient, SqlError>;
  close(): Promise<void>;
}

async function openPglite(): Promise<OpenedDatabase> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: DRIZZLE_MIGRATIONS_FOLDER });
  return { db, sql: sqlClientOverPglite(client), close: () => client.close() };
}

/** Migrates nothing: `db:migrate` is what applies the migrations to a Postgres. */
async function openNodePostgres(connectionString: string): Promise<OpenedDatabase> {
  const pool = new Pool({ connectionString, max: 1 });
  return {
    db: drizzleNodePostgres(pool, { schema }),
    sql: sqlClientOverPool(pool),
    close: () => pool.end(),
  };
}
