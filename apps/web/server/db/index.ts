import { Config, ConfigProvider, Effect, Redacted } from "effect";
import { Pool } from "pg";

/** The variable both pools are built from. */
const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

/** The connection string as one rule reads it: trimmed, and a blank value is absent. */
function connectionStringOf(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The connection string as a `Config`, for the `SqlClient` layer and any
 * other reader on a runtime. It is one reader with `getPool` below: both
 * read `DATABASE_URL` under `connectionStringOf`, so a blank value is absent
 * to both and neither pool can be built where the other refuses. A blank
 * value fails the read the way a missing one does.
 */
export const databaseUrl: Config.Config<Redacted.Redacted> = Config.Redacted(
  DATABASE_ENVIRONMENT.URL,
).pipe(
  Config.mapEffect((url) => {
    const named = connectionStringOf(Redacted.value(url));
    return named === undefined
      ? Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({ message: `${DATABASE_ENVIRONMENT.URL} is blank` }),
          ),
        )
      : Effect.succeed(Redacted.make(named));
  }),
);

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

/**
 * The process-wide pool, read from `DATABASE_URL` on first request. Drizzle's
 * node-postgres session calls this synchronously with no fiber to read a
 * `Config` on, so the read is the record's under the same rule
 * `databaseUrl` applies.
 */
export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = connectionStringOf(process.env[DATABASE_ENVIRONMENT.URL]);
  if (!connectionString) {
    throw new Error(`${DATABASE_ENVIRONMENT.URL} is required to connect to the database.`);
  }

  pool = createPool(connectionString);
  return pool;
}
