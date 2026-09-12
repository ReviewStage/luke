import { randomUUID } from "node:crypto";
import { Client, escapeIdentifier } from "pg";

/**
 * A Postgres of one test file's own, cloned from the database
 * `LUKE_STORE_TEST_DATABASE_URL` names and dropped when the file is done.
 *
 * Locally every opening of the store harness is a fresh PGlite, so a
 * statement that forgets to scope itself by account or conversation reaches
 * only the rows its own file wrote. The CI Postgres job used to point every
 * file at the one database `db:migrate` had migrated, and the same statement
 * there deleted another file's rows, in whichever file the scheduler had
 * running beside it: four times a flake that no reading of the failing file
 * could explain. So on Postgres an opening now clones the migrated database
 * as a template (`create database ... template ...`, one copy of an 11 MB
 * database, tens of milliseconds on Postgres 18) and connects to the clone
 * alone, which gives one opening exactly what PGlite gives it. The
 * clone carries the migrations table, so a test of the migrator sees the
 * database `db:migrate` recorded, and `db:migrate` stays the one runner that
 * applies anything to a Postgres.
 *
 * The statements run on the cluster's maintenance database, `postgres`, not on
 * the template: Postgres refuses to copy a database another session is
 * connected to, and two files cloning at once would each be the other's
 * session. The drop closes any connection still open to the clone, because
 * the clone is nobody's after the file ends, and a connection a test leaked
 * should not turn the file's teardown into a failure about something else.
 */

/** The env var naming a Postgres the store tests should clone from instead of opening PGlite. */
export const STORE_TEST_DATABASE_ENVIRONMENT = {
  URL: "LUKE_STORE_TEST_DATABASE_URL",
} as const;

const CLONE_NAME = {
  PREFIX: "luke_store_test_",
} as const;

const MAINTENANCE_DATABASE = "postgres";

export interface StoreTestPostgres {
  /** The connection string of the clone, and of nothing else. */
  readonly connectionString: string;
  /** Drops the clone; every connection to it must have ended first, and any still open is closed. */
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

/** Clones the database the URL names into one of this opening's own. */
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
