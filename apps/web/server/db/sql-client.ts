import { PgClient } from "@effect/sql-pg";
import { Config, Duration, Effect, Layer, Redacted } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { POOL_LIMITS } from "./index.js";

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
  Effect.map(Config.Redacted("DATABASE_URL"), (url) => PgClient.layer({ url, ...POOL_CONFIG })),
);

/**
 * A `SqlClient` over the database a connection string names, holding one
 * connection and ending it with its own scope: the store's own tests and the
 * end-to-end eval each open one against the same database Drizzle's
 * statements run on, so the effects and the Drizzle statements beside them
 * land on the same connection limit and the same rows.
 */
export const sqlClientOverUrl = (
  connectionString: string,
): Layer.Layer<SqlClient.SqlClient, SqlError> =>
  PgClient.layer({ url: Redacted.make(connectionString), maxConnections: 1 });
