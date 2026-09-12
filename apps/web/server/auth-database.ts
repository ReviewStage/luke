import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Pool, PoolClient } from "pg";
import * as schema from "./db/auth-schema.js";
import { getPool } from "./db/index.js";

export type AuthSchema = typeof schema;

/**
 * Better Auth's adapter over the auth schema, and the one place the choice of
 * adapter is made. It is the Drizzle adapter, not Better Auth's own Kysely
 * one, for a reason the two adapters' documentation never states: on
 * Postgres the Drizzle adapter writes a `string[]` field (`scopes`,
 * `redirect_uris`, `grant_types`, ...) as a native array, and the Kysely
 * adapter writes it as a JSON string. The migrations declare those columns
 * `text[]`, as Better Auth's own CLI generated them for this adapter, so the
 * Kysely adapter's first such write — the token exchange that completes every
 * sign-in — is a malformed array literal to Postgres. Until a migration moves
 * those columns to JSON text, this adapter is the one that fits the schema,
 * and the test over PGlite that writes an access token through it is what
 * holds the two together.
 */
export function authDatabaseAdapter(database: PgDatabase<PgQueryResultHKT, AuthSchema>) {
  return drizzleAdapter(database, { provider: "pg", schema });
}

/**
 * The pool Drizzle queries, resolved at the first query rather than as this
 * module is imported: every function bundle imports the auth service
 * statically, so a pool built here made `DATABASE_URL` a condition of loading
 * any function at all (LUKE-184). Drizzle's node-postgres session calls only
 * `query` and, inside a transaction, `connect` on a client whose constructor
 * name says it is a pool, which this one does; the cast below is what stands
 * in for the rest of `pg.Pool`'s surface, none of which Drizzle reaches.
 */
class LazyPool {
  query(...args: Parameters<Pool["query"]>): ReturnType<Pool["query"]> {
    return getPool().query(...args);
  }

  connect(): Promise<PoolClient> {
    return getPool().connect();
  }
}

// SAFETY: Drizzle's node-postgres session reaches a pool only through `query`, `connect`, and the
// constructor name check above; `LazyPool` answers all three, and every other `pg.Pool` member the
// type names is never called on it.
const lazyPool = new LazyPool() as NodePgClient;

/** Exported for the one test that proves the first query, not the import, is where a missing `DATABASE_URL` fails. */
export const authDatabase = drizzle(lazyPool, { schema });
