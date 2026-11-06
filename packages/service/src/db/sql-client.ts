import { PgClient } from "@effect/sql-pg";
import { databaseOverPgClient } from "@repo/database/core/query";
import { Duration, Effect, Layer } from "effect";
import { databaseUrl, POOL_LIMITS } from "./index.js";

const POOL_CONFIG = {
  maxConnections: POOL_LIMITS.max,
  idleTimeout: Duration.millis(POOL_LIMITS.idleTimeoutMillis),
  connectTimeout: Duration.millis(POOL_LIMITS.connectionTimeoutMillis),
} as const;

export const webSqlClient = Layer.unwrap(
  Effect.map(databaseUrl, (url) =>
    Layer.provideMerge(databaseOverPgClient, PgClient.layer({ url, ...POOL_CONFIG })),
  ),
);
