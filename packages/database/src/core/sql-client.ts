import { PgClient } from "@effect/sql-pg";
import { Duration, Layer, Redacted } from "effect";
import type { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { type Database, databaseOverPgClient } from "./query.js";

export const sqlClientOverUrl = (
  connectionString: string,
): Layer.Layer<SqlClient.SqlClient | PgClient.PgClient | Database, SqlError> =>
  Layer.provideMerge(
    databaseOverPgClient,
    PgClient.layer({
      url: Redacted.make(connectionString),
      maxConnections: 1,
      connectTimeout: Duration.infinity,
    }),
  );
