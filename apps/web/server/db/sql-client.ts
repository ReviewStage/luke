import { PgClient } from "@effect/sql-pg";
import { Duration, Effect, Layer } from "effect";
import { databaseUrl, POOL_LIMITS } from "./index.js";

/**
 * The bounds `POOL_LIMITS` states, in the words `@effect/sql-pg`'s own pool
 * takes them. The two halves of this migration no longer share a `pg.Pool` —
 * v4's driver keeps a pool of its own — so the limits are stated once here
 * and derived from the same constants Drizzle's pool is built to, which is
 * what keeps the two from drifting apart on how much of Neon's pooler one
 * warm instance holds.
 */
const POOL_CONFIG = {
  maxConnections: POOL_LIMITS.max,
  idleTimeout: Duration.millis(POOL_LIMITS.idleTimeoutMillis),
  connectTimeout: Duration.millis(POOL_LIMITS.connectionTimeoutMillis),
} as const;

/**
 * The `SqlClient` every effect on the web runtime reads, over a pool built to
 * the same `POOL_LIMITS` Drizzle's is, so the two halves of this migration
 * cannot drift apart on how many connections one warm instance holds.
 *
 * The layer opens nothing while it builds: the pool keeps no minimum and its
 * first connection is made on the first statement, which is when Drizzle's
 * is. This layer stands in the runtime every function shares, so an eager
 * round trip would land on the cold start of functions that never query.
 */
export const webSqlClient = Layer.unwrap(
  Effect.map(databaseUrl, (url) => PgClient.layer({ url, ...POOL_CONFIG })),
);
