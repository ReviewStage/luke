import { attachDatabasePool } from "@vercel/functions";
import { Config, ConfigProvider, Effect, Option, Redacted } from "effect";
import { Pool } from "pg";

/**
 * The variables the database is reached through: the pooled URL both pools
 * are built from, and the unpooled one a connection that must keep its own
 * session, such as Sync's `LISTEN` or the migrator's, is opened on. Each has
 * the demo branch's name beside it, which Neon's integration never sets: it
 * injects a branch of production into every Preview under the default names,
 * the demo branch's included (`apps/web/server/README.md`).
 */
const DATABASE_ENVIRONMENT = {
  URL: { DEFAULT: "DATABASE_URL", DEMO: "LUKE_DEMO_DATABASE_URL" },
  UNPOOLED_URL: { DEFAULT: "DATABASE_URL_UNPOOLED", DEMO: "LUKE_DEMO_DATABASE_URL_UNPOOLED" },
} as const;

/** One connection's pair of variables. */
type DatabaseVariables = (typeof DATABASE_ENVIRONMENT)[keyof typeof DATABASE_ENVIRONMENT];

/** Vercel's own names for the environment a deployment runs as and the git branch it was built from, both present at build and at run time. */
const VERCEL_ENVIRONMENT = { ENVIRONMENT: "VERCEL_ENV", BRANCH: "VERCEL_GIT_COMMIT_REF" } as const;

/** The environment a deployment runs as, as its own `VERCEL_ENV` names it. */
const DEPLOYMENT_ENVIRONMENT = { PRODUCTION: "production" } as const;

/**
 * The long-lived branch whose Previews are the demo deployment. Note that it
 * must match `DEMO_BRANCH` in `scripts/vercel-ignore.sh`, which builds every
 * deployment of it.
 */
const DEMO_BRANCH = "demo";

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

/** What one connection's variables hold, beside what Vercel says the deployment is. */
interface HeldConnection {
  readonly deployment: string | undefined;
  readonly branch: string | undefined;
  readonly demo: string | undefined;
  readonly fallback: string | undefined;
}

/**
 * The one rule every reader picks a connection string by, each variable
 * under `connectionStringOf`: production reads the default variable alone;
 * the demo branch reads the demo variable alone; any other deployment reads
 * the demo variable where it holds one and the default otherwise. Note that
 * production ignores the demo variable even where it is set, so one scoped
 * wider than the demo branch by mistake cannot move production off its own
 * database, and that the demo branch never falls back, because its default
 * variable may be Neon's branch of production, which a demo must never show:
 * a missing demo variable fails the migrator and refuses every request.
 */
function chosenConnectionString(held: HeldConnection): string | undefined {
  if (held.deployment?.trim() === DEPLOYMENT_ENVIRONMENT.PRODUCTION) {
    return connectionStringOf(held.fallback);
  }
  const demo = connectionStringOf(held.demo);
  return held.branch?.trim() === DEMO_BRANCH ? demo : (demo ?? connectionStringOf(held.fallback));
}

/** What a deployment that finds no connection string lacks: the demo variable on the demo branch, and the default one anywhere else. */
function connectionRequirement(variables: DatabaseVariables): string {
  return `${variables.DEMO} on the ${DEMO_BRANCH} branch, or ${variables.DEFAULT} elsewhere,`;
}

/** One connection's string as a `Config`, chosen by `chosenConnectionString`, or none where the variable it chose holds none. */
function connectionStringConfig(
  variables: DatabaseVariables,
): Config.Config<Option.Option<Redacted.Redacted>> {
  return Config.all({
    deployment: Config.option(Config.String(VERCEL_ENVIRONMENT.ENVIRONMENT)),
    branch: Config.option(Config.String(VERCEL_ENVIRONMENT.BRANCH)),
    demo: Config.option(Config.Redacted(variables.DEMO)),
    fallback: Config.option(Config.Redacted(variables.DEFAULT)),
  }).pipe(
    Config.map(({ deployment, branch, demo, fallback }) =>
      Option.map(
        Option.fromUndefinedOr(
          chosenConnectionString({
            deployment: Option.getOrUndefined(deployment),
            branch: Option.getOrUndefined(branch),
            demo: Option.getOrUndefined(Option.map(demo, Redacted.value)),
            fallback: Option.getOrUndefined(Option.map(fallback, Redacted.value)),
          }),
        ),
        Redacted.make,
      ),
    ),
  );
}

/** One connection's string as a `Config` that fails the read where the variable it chose holds none, as a missing variable does. */
function requiredConnectionString(variables: DatabaseVariables): Config.Config<Redacted.Redacted> {
  return connectionStringConfig(variables).pipe(
    Config.mapEffect(
      Option.match({
        onNone: () =>
          Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `${connectionRequirement(variables)} is missing or blank`,
              }),
            ),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
}

/**
 * The connection string as a `Config`, for the `SqlClient` layer and any
 * other reader on a runtime. It is one reader with `getPool` below: both
 * choose by `chosenConnectionString`, so a blank value is absent to both and
 * neither pool can be built where the other refuses, or on another database.
 */
export const databaseUrl: Config.Config<Redacted.Redacted> = requiredConnectionString(
  DATABASE_ENVIRONMENT.URL,
);

/**
 * The unpooled connection string as a `Config`, or none where it is missing
 * or blank, under the same rule `databaseUrl` reads its own by. Note that it
 * is optional, because a function that cannot see it must still boot: Sync's
 * listener stays down without it, and every wait runs on its clock
 * (`sync/hub.ts`).
 */
export const databaseUnpooledUrl: Config.Config<Option.Option<Redacted.Redacted>> =
  connectionStringConfig(DATABASE_ENVIRONMENT.UNPOOLED_URL);

/** The unpooled connection string for a run that cannot go on without it, the migrator's. */
export const requiredDatabaseUnpooledUrl: Config.Config<Redacted.Redacted> =
  requiredConnectionString(DATABASE_ENVIRONMENT.UNPOOLED_URL);

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
 * The process-wide pool, read on first request. Drizzle's node-postgres
 * session calls this synchronously with no fiber to read a `Config` on, so
 * the read is the record's under the same rule `databaseUrl` applies.
 */
export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = chosenConnectionString({
    deployment: process.env[VERCEL_ENVIRONMENT.ENVIRONMENT],
    branch: process.env[VERCEL_ENVIRONMENT.BRANCH],
    demo: process.env[DATABASE_ENVIRONMENT.URL.DEMO],
    fallback: process.env[DATABASE_ENVIRONMENT.URL.DEFAULT],
  });
  if (!connectionString) {
    throw new Error(
      `${connectionRequirement(DATABASE_ENVIRONMENT.URL)} is required to connect to the database.`,
    );
  }

  pool = createPool(connectionString);
  return pool;
}
