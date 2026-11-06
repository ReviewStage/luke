import { attachDatabasePool } from "@vercel/functions";
import { Config, ConfigProvider, Effect, Option, Redacted } from "effect";
import { Pool } from "pg";

const DATABASE_ENVIRONMENT = {
  URL: "DATABASE_URL",
  UNPOOLED_URL: "DATABASE_URL_UNPOOLED",
} as const;

const ALIASED_SSL_MODE = /(^|&)sslmode=(?:prefer|require|verify-ca)(?=&|$)/;

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

function connectionStringOf(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? withExplicitSslMode(trimmed) : undefined;
}

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

export const databaseUnpooledUrl: Config.Config<Option.Option<Redacted.Redacted>> = Config.option(
  Config.Redacted(DATABASE_ENVIRONMENT.UNPOOLED_URL),
).pipe(
  Config.map((url) =>
    Option.map(
      Option.flatMap(url, (named) =>
        Option.fromUndefinedOr(connectionStringOf(Redacted.value(named))),
      ),
      Redacted.make,
    ),
  ),
);

const DATABASE_POOL_SIZE = 5;

export const POOL_LIMITS = {
  max: DATABASE_POOL_SIZE,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
} as const;

function createPool(connectionString: string): Pool {
  const created = new Pool({ connectionString, ...POOL_LIMITS });
  created.on("error", (error) => {
    console.warn(`An idle database client was dropped: ${error.message}`);
  });
  attachDatabasePool(created);
  return created;
}

let pool: Pool | undefined;

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
