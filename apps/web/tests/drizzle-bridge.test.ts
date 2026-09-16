import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { Effect, Result, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { bridgedRows, DRIZZLE_METHOD, drizzleOverSqlClient } from "../server/db/drizzle.js";
import { testSqlClient } from "./support/sql-client";

/**
 * The Drizzle bridge over the ambient `SqlClient`, on whichever dialect this
 * run was pointed at. The schema modules are restored separately, so the
 * table here is the bridge's own: what is under test is that a builder is
 * yieldable as an Effect, that it reaches the client the running fiber
 * carries rather than a connection of its own, and that the four methods the
 * proxy driver's contract has each dispatch to the statement they stand for.
 */

const bridgeRow = pgTable("drizzle_bridge_row", {
  id: text("id").primaryKey(),
  tally: integer("tally").notNull(),
});

const db = drizzleOverSqlClient({ schema: { bridgeRow } });

const TABLE_ROLLBACK = "The transaction is ended so the bridged insert in it is undone";

/** The throwaway table the bridge is exercised over, made by the client rather than the builder. */
const makeTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`create table if not exists drizzle_bridge_row (id text primary key, tally integer not null)`;
});

/** The header `execute` answers, as much of it as both dialects agree on. */
const HeaderSchema = Schema.Struct({
  rows: Schema.Array(Schema.Struct({ tally: Schema.Number })),
});

it.layer(testSqlClient)("the Drizzle bridge over the ambient SqlClient", (it) => {
  it.effect("a builder is yielded as an Effect and lands on the ambient client", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* makeTable;
      yield* db.insert(bridgeRow).values({ id: "yielded", tally: 3 });
      // The raw client reads what the builder wrote, which is the same
      // database on the same connection and not a second pool's.
      const written = yield* sql`select tally from drizzle_bridge_row where id = 'yielded'`;
      assert.deepEqual(written, [{ tally: 3 }]);
      const read = yield* db.select().from(bridgeRow).where(eq(bridgeRow.id, "yielded"));
      assert.deepEqual(read, [{ id: "yielded", tally: 3 }]);
    }),
  );

  it.effect("the four methods of the driver's contract each dispatch to their statement", () =>
    Effect.gen(function* () {
      const statement = "select $1::text as id, $2::int as tally";
      const params = ["dispatched", 5];
      const all = yield* bridgedRows(statement, params, DRIZZLE_METHOD.ALL);
      assert.deepEqual(all.rows, [["dispatched", 5]]);
      const values = yield* bridgedRows(statement, params, DRIZZLE_METHOD.VALUES);
      assert.deepEqual(values.rows, [["dispatched", 5]]);
      // `get` is the first row of the same positional read, not an array of one.
      const got = yield* bridgedRows(statement, params, DRIZZLE_METHOD.GET);
      assert.deepEqual(got.rows, ["dispatched", 5]);
      // `execute` is the driver's own result, which the proxy reads as one header row.
      const executed = yield* bridgedRows(statement, params, DRIZZLE_METHOD.EXECUTE);
      assert.equal(executed.rows.length, 1);
      assert.deepEqual(Schema.decodeUnknownSync(HeaderSchema)(executed.rows[0]).rows, [
        { tally: 5 },
      ]);
    }),
  );

  it.effect("a refused statement fails as the client's own SqlError, not one wrapping it", () =>
    Effect.gen(function* () {
      yield* makeTable;
      yield* db.insert(bridgeRow).values({ id: "twice", tally: 1 });
      const refused = yield* Effect.result(db.insert(bridgeRow).values({ id: "twice", tally: 2 }));
      assert.ok(Result.isFailure(refused));
      // Drizzle wraps whatever the callback threw in a `DrizzleQueryError`
      // carrying the statement's text, and what the constraint said has to
      // survive that: a reason wrapping the wrapper says nothing.
      assert.ok(!(refused.failure.reason.cause instanceof DrizzleQueryError));
    }),
  );

  it.effect("a bridged statement is inside the transaction around it and rolls back with it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* makeTable;
      const ended = yield* Effect.result(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* db.insert(bridgeRow).values({ id: "rolled-back", tally: 9 });
            // The read is bridged too, and it sees a row no other connection
            // could: the insert is in this transaction rather than beside it.
            const inside = yield* db
              .select()
              .from(bridgeRow)
              .where(eq(bridgeRow.id, "rolled-back"));
            assert.deepEqual(inside, [{ id: "rolled-back", tally: 9 }]);
            return yield* Effect.fail(new Error(TABLE_ROLLBACK));
          }),
        ),
      );
      assert.ok(Result.isFailure(ended));
      const after = yield* sql`select id from drizzle_bridge_row where id = 'rolled-back'`;
      assert.deepEqual(after, []);
    }),
  );
});
