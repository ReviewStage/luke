import { PgClient } from "@effect/sql-pg";
import { Duration, type Layer, Redacted } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";

/**
 * A `SqlClient` over the database a connection string names, holding one
 * connection and ending it with its own scope: the store's own tests and the
 * end-to-end eval each open one against the same database Drizzle's
 * statements run on, so the effects and the Drizzle statements beside them
 * land on the same connection limit and the same rows.
 *
 * Note that the connect timeout is off, because it runs on the caller's
 * `Clock`: a store test that moves its `TestClock` past five seconds while
 * the pool is opening its connection would otherwise fail that connection
 * though the database answered.
 */
export const sqlClientOverUrl = (
  connectionString: string,
): Layer.Layer<SqlClient.SqlClient, SqlError> =>
  PgClient.layer({
    url: Redacted.make(connectionString),
    maxConnections: 1,
    connectTimeout: Duration.infinity,
  });
