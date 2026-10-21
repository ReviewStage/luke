import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Stream } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlConnection from "effect/sql/SqlConnection";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import { databaseOverPgClient } from "../core/query.js";

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
