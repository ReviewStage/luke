import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** Bounded so one warm function instance cannot monopolize Neon's pooler. */
export const POOL_LIMITS = {
  max: 1,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
} as const;

/**
 * Builds a pool for an explicit connection string. Opens nothing: `pg.Pool`
 * connects lazily on first query, which makes this testable offline.
 */
export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, ...POOL_LIMITS });
}

/** A database over an explicit connection string: the testable seam. */
export function createDatabase(connectionString: string) {
  return drizzle(createPool(connectionString), { schema });
}

let database: ReturnType<typeof createDatabase> | undefined;

/** The process-wide database, read from `DATABASE_URL` on first request. */
export function getDatabase(): ReturnType<typeof createDatabase> {
  if (database) {
    return database;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to the database.");
  }

  database = createDatabase(connectionString);
  return database;
}
