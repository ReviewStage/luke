import { Pool } from "pg";

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

let pool: Pool | undefined;

/** The process-wide pool, read from `DATABASE_URL` on first request. */
export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to the database.");
  }

  pool = createPool(connectionString);
  return pool;
}
