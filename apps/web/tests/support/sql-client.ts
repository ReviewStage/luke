import * as Reactivity from "@effect/experimental/Reactivity";
import * as SqlClient from "@effect/sql/SqlClient";
import type * as SqlConnection from "@effect/sql/SqlConnection";
import { SqlError } from "@effect/sql/SqlError";
import { PgClient } from "@effect/sql-pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Effect, Layer, Stream } from "effect";
import { createPool } from "../../server/db/index.js";
import { MIGRATIONS_FOLDER, STORE_TEST_DATABASE_ENVIRONMENT } from "./hosted-store-database.js";

/**
 * The `SqlClient` the store's own tests will read, standing over the same two
 * dialects `hosted-store-database.ts` already chooses between: PGlite in
 * process by default, so `check.sh` needs no service, and the Postgres named by
 * `LUKE_STORE_TEST_DATABASE_URL` in the CI job that has one. The Postgres half
 * is the production layer's own client; the PGlite half is the small connection
 * below, because no `@effect/sql-pglite` ships against the 3.x Effect line.
 */

const ROW_MODE = {
  ARRAY: "array",
} as const;

function pgliteConnection(client: PGlite): SqlConnection.Connection {
  const fail = (cause: unknown) => new SqlError({ cause, message: "Failed to execute statement" });
  const objectRows = (sql: string, params: ReadonlyArray<unknown>) =>
    Effect.tryPromise({
      try: () => client.query<SqlConnection.Row>(sql, [...params]),
      catch: fail,
    });
  const rows = (
    sql: string,
    params: ReadonlyArray<unknown>,
    transformRows: (<A extends object>(row: ReadonlyArray<A>) => ReadonlyArray<A>) | undefined,
  ) =>
    objectRows(sql, params).pipe(
      Effect.map((result) => (transformRows ? transformRows(result.rows) : result.rows)),
    );
  return {
    execute: rows,
    executeRaw: (sql, params) => objectRows(sql, params),
    executeUnprepared: rows,
    executeStream: (sql, params, transformRows) =>
      Stream.fromIterableEffect(rows(sql, params, transformRows)),
    executeValues: (sql, params) =>
      Effect.tryPromise({
        try: () =>
          client.query<ReadonlyArray<unknown>>(sql, [...params], { rowMode: ROW_MODE.ARRAY }),
        catch: fail,
      }).pipe(Effect.map((result) => result.rows)),
  };
}

/** A PGlite carrying the same generated migrations the store's tests run against. */
async function openMigratedPglite(): Promise<PGlite> {
  const client = new PGlite();
  await migratePglite(drizzlePglite(client), { migrationsFolder: MIGRATIONS_FOLDER });
  return client;
}

const pgliteSqlClient = Layer.scoped(
  SqlClient.SqlClient,
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.promise(() => openMigratedPglite()),
      (client) => Effect.promise(() => client.close()),
    );
    return yield* SqlClient.make({
      acquirer: Effect.succeed(pgliteConnection(client)),
      compiler: PgClient.makeCompiler(),
      spanAttributes: [],
    });
  }),
).pipe(Layer.provide(Reactivity.layer));

function postgresSqlClient(connectionString: string) {
  return PgClient.layerFromPool({
    acquire: Effect.acquireRelease(
      Effect.sync(() => createPool(connectionString)),
      (pool) => Effect.promise(() => pool.end()),
    ),
  });
}

const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];

/** The client a test reads, over whichever dialect this run was pointed at. */
export const testSqlClient: Layer.Layer<SqlClient.SqlClient, SqlError> =
  connectionString === undefined ? pgliteSqlClient : postgresSqlClient(connectionString);
