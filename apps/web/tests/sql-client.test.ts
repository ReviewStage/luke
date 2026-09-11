import assert from "node:assert/strict";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { testSqlClient } from "./support/sql-client.js";

/**
 * What the client answers, on whichever dialect this run stands over. The store
 * itself still runs on Drizzle; these are the two things the layer has to do
 * before anything is moved onto it — speak to the database at all, and read a
 * table the generated migrations created.
 */
it.layer(testSqlClient)("the web SQL client", (it) => {
  it.effect("answers a statement of its own", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly one: number }>`select 1 as one`;
      assert.deepEqual([...rows], [{ one: 1 }]);
    }),
  );

  it.effect("reads a table the migrations created, through a parameter", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        readonly id: string;
      }>`select id from "user" where id = ${"no-such-user"}`;
      assert.equal(rows.length, 0);
    }),
  );
});
