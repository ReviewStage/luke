import * as Reactivity from "@effect/experimental/Reactivity";
import * as SqlClient from "@effect/sql/SqlClient";
import type * as SqlConnection from "@effect/sql/SqlConnection";
import { SqlError } from "@effect/sql/SqlError";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Stream } from "effect";
import type { HostedStoreRun } from "../../server/hosted/store/database";

const refused = () =>
  Effect.fail(
    new SqlError({
      cause: new Error("this test's store is a memory fake"),
      message: "No database is open in this test",
    }),
  );

const refusingConnection: SqlConnection.Connection = {
  execute: refused,
  executeRaw: refused,
  executeUnprepared: refused,
  executeValues: refused,
  executeStream: () => Stream.fromEffect(refused()),
};

const noDatabase = Layer.scoped(
  SqlClient.SqlClient,
  SqlClient.make({
    acquirer: Effect.succeed(refusingConnection),
    transactionAcquirer: Effect.succeed(refusingConnection),
    compiler: PgClient.makeCompiler(),
    spanAttributes: [],
  }),
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
export const runWithoutDatabase: HostedStoreRun = (effect) =>
  Effect.runPromise(Effect.provide(effect, noDatabase));
