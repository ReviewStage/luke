import * as Reactivity from "@effect/experimental/Reactivity";
import * as SqlClient from "@effect/sql/SqlClient";
import type * as SqlConnection from "@effect/sql/SqlConnection";
import { SqlError } from "@effect/sql/SqlError";
import { PgClient } from "@effect/sql-pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Effect, Layer, Stream } from "effect";
import { DRIZZLE_MIGRATIONS_FOLDER } from "../../server/db/effect-migrator.js";
import { createPool } from "../../server/db/index.js";

/**
 * The `SqlClient` the store's own tests will read, standing over the same two
 * dialects `hosted-store-database.ts` already chooses between: PGlite in
 * process by default, so `check.sh` needs no service, and the Postgres named by
 * `LUKE_STORE_TEST_DATABASE_URL` in the CI job that has one. The Postgres half
 * is the production layer's own client; the PGlite half is the small connection
 * below, because no `@effect/sql-pglite` ships against the 3.x Effect line.
 */

/** The env var naming a Postgres the store tests should run against instead of PGlite. */
export const STORE_TEST_DATABASE_ENVIRONMENT = {
  URL: "LUKE_STORE_TEST_DATABASE_URL",
} as const;

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

/**
 * A `SqlClient` over a PGlite the caller already opened and still closes
 * itself, so a harness holding one database can read it through this client
 * and through the Drizzle handle beside it.
 *
 * PGlite is one connection, so the client is handed that connection under a
 * permit rather than directly: a statement holds the permit for its own
 * execution and a transaction for its whole span, which is what a pool gives
 * a Postgres and what PGlite's own exclusive transaction gave the Drizzle
 * handle beside this one. Without it two concurrent transactions would
 * nest their `BEGIN` on one connection and a plain read of another fiber
 * would land inside whichever transaction was open.
 */
export const sqlClientOverPglite = (client: PGlite): Layer.Layer<SqlClient.SqlClient> =>
  Layer.scoped(
    SqlClient.SqlClient,
    Effect.flatMap(Effect.makeSemaphore(1), (connections) => {
      const exclusive = Effect.acquireRelease(
        Effect.as(connections.take(1), pgliteConnection(client)),
        () => connections.release(1),
      );
      return SqlClient.make({
        acquirer: exclusive,
        transactionAcquirer: exclusive,
        compiler: PgClient.makeCompiler(),
        spanAttributes: [],
      });
    }),
  ).pipe(Layer.provide(Reactivity.layer));

/** A PGlite carrying the same generated migrations the store's tests run against. */
async function openMigratedPglite(): Promise<PGlite> {
  const client = new PGlite();
  await migratePglite(drizzlePglite(client), { migrationsFolder: DRIZZLE_MIGRATIONS_FOLDER });
  return client;
}

function pgliteSqlClientOver(open: () => Promise<PGlite>) {
  return Layer.unwrapScoped(
    Effect.map(
      Effect.acquireRelease(Effect.promise(open), (client) => Effect.promise(() => client.close())),
      sqlClientOverPglite,
    ),
  );
}

const pgliteSqlClient = pgliteSqlClientOver(openMigratedPglite);

/**
 * A PGlite with nothing applied to it, which is what a test of the migration
 * runner itself needs: the shared Postgres a CI run points at has already been
 * migrated, so only an in-process database can stand in for a fresh one.
 */
export const unmigratedPgliteSqlClient: Layer.Layer<SqlClient.SqlClient, SqlError> =
  pgliteSqlClientOver(async () => new PGlite());

/** A PGlite the Drizzle runner migrated, so its history is Drizzle's own. */
export const drizzleMigratedPgliteSqlClient: Layer.Layer<SqlClient.SqlClient, SqlError> =
  pgliteSqlClient;

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
