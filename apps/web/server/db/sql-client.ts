import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Redacted } from "effect";
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
