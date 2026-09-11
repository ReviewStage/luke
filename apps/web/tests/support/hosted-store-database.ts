import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { DRIZZLE_MIGRATIONS_FOLDER } from "../../server/db/effect-migrator";
import * as schema from "../../server/db/schema";
import { payloadKeyRing } from "../../server/hosted/encryption";
import { type HostedStore, type HostedStoreDatabase, hostedStore } from "../../server/hosted/store";

/**
 * The store's tests run against the real generated migrations on a real
 * Postgres dialect: PGlite in process by default, so `check.sh` needs no
 * service, or the Postgres named by `LUKE_STORE_TEST_DATABASE_URL`, which the
 * CI job points at its service container after `db:migrate` has run there. A
 * PGlite is migrated here, because it is opened empty; a Postgres is not,
 * because `db:migrate` is the one runner that records what it applied.
 */

/** The env var naming a Postgres the store tests should run against instead of PGlite. */
export const STORE_TEST_DATABASE_ENVIRONMENT = {
  URL: "LUKE_STORE_TEST_DATABASE_URL",
} as const;

export const TEST_PAYLOAD_SECRET = "c".repeat(64);

export const MIGRATIONS_FOLDER = DRIZZLE_MIGRATIONS_FOLDER;

export interface HostedStoreTestDatabase {
  readonly db: HostedStoreDatabase;
  readonly store: HostedStore;
  /** Inserts a user row for one test, answering the id every other row hangs from. */
  createUser(): Promise<string>;
  close(): Promise<void>;
}

export async function openHostedStoreTestDatabase(): Promise<HostedStoreTestDatabase> {
  const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];
  const opened = connectionString ? await openNodePostgres(connectionString) : await openPglite();
  const keys = payloadKeyRing(TEST_PAYLOAD_SECRET);
  return {
    db: opened.db,
    store: hostedStore({ db: opened.db, keys }),
    async createUser() {
      const id = `user-${randomUUID()}`;
      await opened.db.insert(schema.user).values({
        id,
        name: "Test User",
        email: `${id}@luke.test`,
      });
      return id;
    },
    close: opened.close,
  };
}

interface OpenedDatabase {
  readonly db: HostedStoreDatabase;
  close(): Promise<void>;
}

async function openPglite(): Promise<OpenedDatabase> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

/** Migrates nothing: `db:migrate` is what applies the migrations to a Postgres. */
async function openNodePostgres(connectionString: string): Promise<OpenedDatabase> {
  const pool = new Pool({ connectionString, max: 1 });
  return { db: drizzleNodePostgres(pool, { schema }), close: () => pool.end() };
}
