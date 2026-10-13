import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { it } from "@effect/vitest";
import { drizzleOverSqlClient } from "@sidecar/database/core/drizzle";
import { getTestDB } from "@sidecar/database/testing";
import { eq } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { Effect, Result } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

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

/**
 * The async context a statement leaves its caller in, which is what the
 * test at the end of this file reads. eve keeps its session container in one
 * of these, and the relay's state accessors read it after every statement a
 * hook runs, so the context a bridged statement leaves standing is part of
 * the bridge's contract rather than an implementation detail of the door.
 */
const standing = new AsyncLocalStorage<string>();

/** The caller whose own statement never waits, so nothing else can leave it anywhere. */
const ALONE = "alone";

/**
 * Enters an async context the way a host enters one, and leaves the fiber
 * running inside it. Effect captures a fiber's async context when it suspends
 * and resumes it there, so the context is entered on the fiber's own stack and
 * the fiber then yields once, which is what makes the entered one the context
 * it carries rather than the one it was forked in.
 */
const entering = (tag: string): Effect.Effect<void> =>
  Effect.andThen(
    Effect.sync(() => standing.enterWith(tag)),
    Effect.yieldNow,
  );

/** One statement, built where it is yielded, so three callers share no builder. */
type Statement = () => Effect.Effect<unknown, SqlError, SqlClient.SqlClient>;

/**
 * What one caller finds standing after its own statement: it enters a context
 * of its own, yields the statement, and reads the context back one step
 * later, which is where a hook reads eve's container.
 */
const leftStandingAfter = (tag: string, statement: Statement) =>
  Effect.gen(function* () {
    yield* entering(tag);
    yield* statement();
    return yield* Effect.sync(() => standing.getStore());
  });

it.layer(getTestDB())("the Drizzle bridge over the ambient SqlClient", (it) => {
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

  it.effect("one bridged statement leaves its caller exactly where a raw one does", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* makeTable;
      // Whether a statement waiting for nothing leaves its caller in its own
      // context is Effect's and the driver's answer, not the bridge's, so the
      // raw statement is what the bridged one is read against.
      const raw = yield* leftStandingAfter(ALONE, () => sql`select 1 as one`);
      // Guard: a run where the caller found no context standing proves
      // nothing, since a bridge that dropped every context would answer the same.
      assert.notEqual(raw, undefined);
      const bridged = yield* leftStandingAfter(ALONE, () => db.select().from(bridgeRow));
      assert.equal(bridged, raw);
    }),
  );
});
