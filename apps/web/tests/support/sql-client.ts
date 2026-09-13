import { NodeServices } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";
import { SqlError } from "effect/unstable/sql/SqlError";
import { runWebMigrations } from "../../server/db/effect-migrator.js";
import { createPool } from "../../server/db/index.js";
import { cloneStoreTestPostgres, STORE_TEST_DATABASE_ENVIRONMENT } from "./store-test-postgres.js";

/**
 * The `SqlClient` the store's own tests will read, standing over the same two
 * dialects `hosted-store-database.ts` already chooses between: PGlite in
 * process by default, so `check.sh` needs no service, and the Postgres named by
 * `LUKE_STORE_TEST_DATABASE_URL` in the CI job that has one. Either way a
 * build of the layer is a database of its own: a fresh PGlite, or a clone of
 * the migrated Postgres dropped when the layer's scope closes
 * (`store-test-postgres.ts`), so a file's unscoped statement reaches no other
 * file's rows on either dialect. The Postgres half is the production layer's
 * own client; the PGlite half is the small connection below, because no
 * `@effect/sql-pglite` ships against the 3.x Effect line.
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
  Layer.effect(
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
export async function openMigratedPglite(): Promise<PGlite> {
  const client = new PGlite();
  const migrationRuntime = ManagedRuntime.make(
    Layer.mergeAll(sqlClientOverPglite(client), NodeServices.layer),
  );
  try {
    await migrationRuntime.runPromise(runWebMigrations());
  } finally {
    await migrationRuntime.dispose();
  }
  return client;
}

function pgliteSqlClientOver(open: () => Promise<PGlite>) {
  return Layer.unwrap(
    Effect.map(
      Effect.acquireRelease(Effect.promise(open), (client) => Effect.promise(() => client.close())),
      sqlClientOverPglite,
    ),
  );
}

const pgliteSqlClient = pgliteSqlClientOver(openMigratedPglite);

/**
 * A PGlite with nothing applied to it, which is what a test of the migration
 * runner itself needs: the Postgres a CI run clones from has already been
 * migrated, so only an in-process database can stand in for a fresh one.
 */
export const unmigratedPgliteSqlClient: Layer.Layer<SqlClient.SqlClient, SqlError> =
  pgliteSqlClientOver(async () => new PGlite());

/**
 * The pool ends before the clone drops: the pool's finalizer is registered
 * after the clone's in the same scope, and finalizers run in reverse.
 */
function postgresSqlClient(connectionString: string) {
  return Layer.unwrap(
    Effect.map(
      Effect.acquireRelease(
        Effect.promise(() => cloneStoreTestPostgres(connectionString)),
        (clone) => Effect.promise(() => clone.drop()),
      ),
      (clone) =>
        PgClient.layerFromPool({
          acquire: Effect.acquireRelease(
            Effect.sync(() => createPool(clone.connectionString)),
            (pool) => Effect.promise(() => pool.end()),
          ),
        }),
    ),
  );
}

const connectionString = process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL];

/** The client a test reads, over whichever dialect this run was pointed at. */
export const testSqlClient: Layer.Layer<SqlClient.SqlClient, SqlError> =
  connectionString === undefined ? pgliteSqlClient : postgresSqlClient(connectionString);
