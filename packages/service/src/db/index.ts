import { attachDatabasePool } from "@vercel/functions";
import { Config, ConfigProvider, Effect, Redacted } from "effect";
import { Pool } from "pg";

/** The variable both pools are built from. */
const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

/**
 * The `sslmode` values `pg-connection-string` (v2) already treats as
 * `verify-full`, and warns it will weaken in v3 / `pg` v9.
 */
const ALIASED_SSL_MODE = /(^|&)sslmode=(?:prefer|require|verify-ca)(?=&|$)/;

/**
 * Says `sslmode=verify-full` where the string says one of the modes `pg` v8
 * already treats as it. Note that this changes no trust: the driver verifies
 * the certificate chain and the host name under all four today, so the
 * rewrite only spells the present behavior out and stops the driver logging
 * its "SECURITY WARNING: The SSL modes…" notice on each process's first
 * connection. A string asking for `uselibpqcompat=true` has chosen libpq's
 * own semantics, which are weaker, so it is left as it is.
 */
function withExplicitSslMode(connectionString: string): string {
  const queryAt = connectionString.indexOf("?");
  if (queryAt === -1) {
    return connectionString;
  }

  const query = connectionString.slice(queryAt + 1);
  if (/(^|&)uselibpqcompat=true(?=&|$)/.test(query)) {
    return connectionString;
  }

  return `${connectionString.slice(0, queryAt + 1)}${query.replace(ALIASED_SSL_MODE, "$1sslmode=verify-full")}`;
}

/** The connection string as one rule reads it: trimmed, and a blank value is absent. */
function connectionStringOf(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? withExplicitSslMode(trimmed) : undefined;
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

/**
 * Connections one function instance may hold per pool. Several requests share
 * an instance under Fluid compute, and with one connection every read, every
 * `Effect.all({ concurrency })` branch and every request queued behind the
 * one in flight. `DATABASE_URL` is Neon's pooled (PgBouncer) endpoint, so a
 * few server-side clients per instance cost the database next to nothing.
 */
const DATABASE_POOL_SIZE = 5;

/** Bounded so one warm function instance cannot monopolize Neon's pooler. */
export const POOL_LIMITS = {
  max: DATABASE_POOL_SIZE,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
} as const;

/**
 * Builds a pool for an explicit connection string. Opens nothing: `pg.Pool`
 * connects lazily on first query, which makes this testable offline.
 *
 * An idle client whose connection the database or the network ends is
 * reported through the pool's `error` event, and Node throws an `error` event
 * nobody listens to: the instance, and every request it was serving under
 * Fluid compute, went down with it (Sentry LUKE-WEB-T). The listener logs it
 * instead, and the pool has already dropped that client, so the next query
 * opens a fresh connection. `attachDatabasePool` is Vercel's guard against the
 * usual cause, a client left idle while the instance is suspended: it keeps
 * the instance up after each release until the idle timeout has closed the
 * pool's idle clients.
 */
function createPool(connectionString: string): Pool {
  const created = new Pool({ connectionString, ...POOL_LIMITS });
  created.on("error", (error) => {
    console.warn(`An idle database client was dropped: ${error.message}`);
  });
  attachDatabasePool(created);
  return created;
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
