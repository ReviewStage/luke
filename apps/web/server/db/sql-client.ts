import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Redacted } from "effect";
import type { Pool } from "pg";
import { createPool } from "./index.js";

/**
 * The `SqlClient` every effect on the web runtime reads, over a pool built to
 * the same `POOL_LIMITS` Drizzle's is, so the two halves of this migration
 * cannot drift apart on how many connections one warm instance holds.
 *
 * `layerFromPool` rather than `PgClient.layer`, which runs `SELECT 1` while the
 * layer builds: this layer stands in the runtime every function shares, so an
 * eager round trip would land on the cold start of functions that never query.
 * `pg.Pool` connects on its first query instead, which is when Drizzle's does.
 */
export const webSqlClient = Layer.unwrapEffect(
  Effect.map(Config.redacted("DATABASE_URL"), (url) =>
    PgClient.layerFromPool({
      acquire: Effect.acquireRelease(
        Effect.sync(() => createPool(Redacted.value(url))),
        (pool) => Effect.promise(() => pool.end()),
      ),
    }),
  ),
);

/**
 * A `SqlClient` over a pool the caller already holds and still ends itself:
 * the store's own tests and the end-to-end eval each open one pool and read it
 * through both halves of this migration, so the effects and the Drizzle
 * statements beside them land on the same connection limit and the same rows.
 */
export const sqlClientOverPool = (pool: Pool): Layer.Layer<SqlClient.SqlClient, SqlError> =>
  PgClient.layerFromPool({ acquire: Effect.succeed(pool) });
