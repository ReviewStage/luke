import { PgClient } from "@effect/sql-pg";
import { databaseOverPgClient } from "@luke/database/core/query";
import { Effect, Layer, Stream } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlConnection from "effect/sql/SqlConnection";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import type { HostedStoreTestRun } from "./hosted-store-database";

const refused = () =>
  Effect.fail(
    new SqlError({
      reason: new UnknownError({
        cause: new Error("this test's store is a memory fake"),
        message: "No database is open in this test",
      }),
    }),
  );

const refusingConnection: SqlConnection.Connection = {
  execute: refused,
  executeRaw: refused,
  executeUnprepared: refused,
  executeValues: refused,
  executeValuesUnprepared: refused,
  executeStream: () => Stream.fromEffect(refused()),
};

/**
 * A `PgClient` over the refusing connection, so the Drizzle `Database` the
 * runtime builds over its `PgClient` stands over this one unchanged and
 * refuses every statement the same way.
 */
const refusingPgClient = Effect.map(
  SqlClient.make({
    acquirer: Effect.succeed(refusingConnection),
    transactionAcquirer: Effect.succeed(refusingConnection),
    compiler: PgClient.makeCompiler(),
    spanAttributes: [],
  }),
  (client): PgClient.PgClient =>
    Object.assign(client, {
      [PgClient.TypeId]: PgClient.TypeId,
      config: {},
      // Every statement refuses, so the fragment a JSON value would render is never sent.
      json: () => client`null`,
      listen: refused,
      notify: refused,
    }),
);

export const noDatabase = Layer.provideMerge(
  databaseOverPgClient,
  PgClient.layerFrom(refusingPgClient),
).pipe(Layer.provide(Reactivity.layer));

/**
 * The runner a handler test hands the modules that now take one, over a
 * client that refuses every statement. Those tests stand a memory fake in
 * place of the store, so nothing they run reaches a connection; a statement
 * that did reach one is a test asking for a database it never opened, and
 * this is what makes that a failure rather than a silent read of nothing.
 * The store's own tests run against PGlite or Postgres through
 * `hosted-store-database.ts` instead.
 */
export const runWithoutDatabase: HostedStoreTestRun = (effect) =>
  Effect.runPromise(Effect.provide(effect, noDatabase));
