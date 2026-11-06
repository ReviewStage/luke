import { randomUUID } from "node:crypto";
import { Client, escapeIdentifier } from "pg";

export const STORE_TEST_DATABASE_ENVIRONMENT = {
  URL: "APP_STORE_TEST_DATABASE_URL",
} as const;

const CLONE_NAME = {
  PREFIX: "luke_store_test_",
} as const;

const MAINTENANCE_DATABASE = "postgres";

export interface StoreTestPostgres {
  readonly connectionString: string;
  drop(): Promise<void>;
}

function databaseNamed(connectionString: string, name: string): URL {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url;
}

function templateNamed(connectionString: string): string {
  const name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (name.length === 0) {
    throw new Error(
      `${STORE_TEST_DATABASE_ENVIRONMENT.URL} names no database to clone the store tests' Postgres from`,
    );
  }
  return name;
}

async function onMaintenanceDatabase<A>(
  connectionString: string,
  statement: (client: Client) => Promise<A>,
): Promise<A> {
  const client = new Client({
    connectionString: databaseNamed(connectionString, MAINTENANCE_DATABASE).href,
  });
  await client.connect();
  try {
    return await statement(client);
  } finally {
    await client.end();
  }
}

export async function cloneStoreTestPostgres(connectionString: string): Promise<StoreTestPostgres> {
  const template = templateNamed(connectionString);
  const clone = `${CLONE_NAME.PREFIX}${randomUUID().replaceAll("-", "")}`;
  await onMaintenanceDatabase(connectionString, (client) =>
    client.query(
      `create database ${escapeIdentifier(clone)} template ${escapeIdentifier(template)}`,
    ),
  );
  return {
    connectionString: databaseNamed(connectionString, clone).href,
    drop: () =>
      onMaintenanceDatabase(connectionString, async (client) => {
        await client.query(`drop database ${escapeIdentifier(clone)} with (force)`);
      }),
  };
}
