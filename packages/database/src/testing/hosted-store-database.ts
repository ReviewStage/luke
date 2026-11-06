import { randomUUID } from "node:crypto";
import { atInstant } from "@repo/wire/testing";
import { Effect, type Layer, ManagedRuntime } from "effect";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { sqlClientOverUrl } from "../core/sql-client.js";
import { type HostedStore, hostedStore } from "../models/hosted-store.js";
import { user } from "../schemas/auth.js";
import { openMigratedPglite, sqlClientOverPglite } from "./sql-client.js";
import { cloneStoreTestPostgres, STORE_TEST_DATABASE_ENVIRONMENT } from "./test-postgres.js";

export type HostedStoreTestRun = <A, E>(
  effect: Effect.Effect<A, E, DatabaseServices>,
) => Promise<A>;

interface HostedStoreTestDatabase {
  readonly store: HostedStore;
  readonly sql: Layer.Layer<DatabaseServices, QueryError>;
  readonly run: HostedStoreTestRun;
  readonly anotherConnection: (() => Layer.Layer<DatabaseServices, QueryError>) | undefined;
  createUser(): Promise<string>;
  close(): Promise<void>;
}

const TEST_USER_NAME = "Test User";

interface HostedStoreTestDatabaseOptions {
  readonly at?: number;
}

export async function openHostedStoreTestDatabase({
  at,
}: HostedStoreTestDatabaseOptions = {}): Promise<HostedStoreTestDatabase> {
  const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];
  const opened = connectionString ? await openNodePostgres(connectionString) : await openPglite();
  const runtime = ManagedRuntime.make(opened.sql);
  const run: HostedStoreTestRun = (effect) =>
    runtime.runPromise(at === undefined ? effect : atInstant(at)(effect));
  return {
    sql: opened.sql,
    run,
    anotherConnection: opened.anotherConnection,
    store: hostedStore(),
    createUser() {
      const id = `user-${randomUUID()}`;
      return run(
        Effect.asVoid(
          Database.use((db) =>
            db.insert(user).values({ id, name: TEST_USER_NAME, email: `${id}@app.test` }),
          ),
        ),
      ).then(() => id);
    },
    async close() {
      await runtime.dispose();
      await opened.close();
    },
  };
}

interface OpenedDatabase {
  readonly sql: Layer.Layer<DatabaseServices, QueryError>;
  readonly anotherConnection: HostedStoreTestDatabase["anotherConnection"];
  close(): Promise<void>;
}

async function openPglite(): Promise<OpenedDatabase> {
  const client = await openMigratedPglite();
  return {
    sql: sqlClientOverPglite(client),
    anotherConnection: undefined,
    close: () => client.close(),
  };
}

async function openNodePostgres(connectionString: string): Promise<OpenedDatabase> {
  const clone = await cloneStoreTestPostgres(connectionString);
  return {
    sql: sqlClientOverUrl(clone.connectionString),
    anotherConnection: () => sqlClientOverUrl(clone.connectionString),
    close: () => clone.drop(),
  };
}
