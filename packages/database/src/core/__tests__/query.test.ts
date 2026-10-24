import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { getTestDB } from "../../testing/index.js";
import { READ_CONCURRENCY, readConcurrency } from "../query.js";

/**
 * A read's independent statements run a few at once outside a transaction,
 * each on a connection of the pool, and one at a time inside one, where they
 * share its connection, over a real dialect.
 */

it.layer(getTestDB())("how many of a read's statements run at once", (it) => {
  it.effect("a few outside a transaction, and one inside one, nested or not", () =>
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;

      const outside = yield* readConcurrency;
      const inside = yield* client.withTransaction(readConcurrency);
      const nested = yield* client.withTransaction(client.withTransaction(readConcurrency));
      const after = yield* readConcurrency;

      assert.ok(outside > 1);
      assert.deepEqual(
        [outside, inside, nested, after],
        [READ_CONCURRENCY, 1, 1, READ_CONCURRENCY],
      );
    }),
  );
});
