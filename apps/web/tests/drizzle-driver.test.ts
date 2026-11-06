import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices, type QueryError } from "@repo/database/core/query";
import { getTestDB } from "@repo/database/testing";
import { failureKind } from "@repo/runtime/effect";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { Cause, Effect, Result } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { isSqlError, type SqlError } from "effect/sql/SqlError";
import { expectTypeOf } from "vitest";

const driverRow = pgTable("drizzle_driver_row", {
  id: text("id").primaryKey(),
  tally: integer("tally").notNull(),
});

const TABLE_ROLLBACK = "The transaction is ended so the Drizzle insert in it is undone";

const SECRET_PARAMETER = "sk-live-never-in-a-failure";

const makeTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`create table if not exists drizzle_driver_row (id text primary key, tally integer not null)`;
});

const standing = new AsyncLocalStorage<string>();

const ALONE = "alone";

const entering = (tag: string): Effect.Effect<void> =>
  Effect.andThen(
    Effect.sync(() => standing.enterWith(tag)),
    Effect.yieldNow,
  );

type Statement = () => Effect.Effect<unknown, QueryError, DatabaseServices>;

const leftStandingAfter = (tag: string, statement: Statement) =>
  Effect.gen(function* () {
    yield* entering(tag);
    yield* statement();
    return yield* Effect.sync(() => standing.getStore());
  });

const refusedInsert = (test: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `${SECRET_PARAMETER}-${test}`;
    yield* makeTable;
    yield* db.insert(driverRow).values({ id, tally: 1 });
    const refused = yield* Effect.result(db.insert(driverRow).values({ id, tally: 2 }));
    assert.ok(Result.isFailure(refused));
    return refused.failure;
  });

const insideTransaction = Effect.gen(function* () {
  const db = yield* Database;
  return yield* db.transaction(() => db.select().from(driverRow));
});
expectTypeOf<Effect.Error<typeof insideTransaction>>().not.toBeAny();
expectTypeOf<Effect.Error<typeof insideTransaction>>().toEqualTypeOf<
  EffectDrizzleQueryError | SqlError
>();
const statementAlone = Database.use((db) => db.select().from(driverRow));
expectTypeOf<Effect.Error<typeof statementAlone>>().not.toBeAny();
expectTypeOf<Effect.Error<typeof statementAlone>>().toEqualTypeOf<EffectDrizzleQueryError>();

it.layer(getTestDB())("Drizzle's Effect driver over the test database's client", (it) => {
  it.effect(
    "a unique violation still reads as the client's own reason beneath the driver's error",
    () =>
      Effect.gen(function* () {
        const refused = yield* refusedInsert("reason");
        assert.equal(refused._tag, "EffectDrizzleQueryError");
        const beneath = Cause.squash(
          Cause.isCause(refused.cause) ? refused.cause : Cause.die(refused.cause),
        );
        assert.ok(isSqlError(beneath));
        assert.equal(beneath.reason._tag, "UniqueViolation");
        assert.equal(failureKind(refused), "SqlError: UniqueViolation");
      }),
  );

  it.effect("the driver's failure carries none of the values the statement bound", () =>
    Effect.gen(function* () {
      const refused = yield* refusedInsert("parameters");
      assert.deepEqual(refused.params, []);
      assert.ok(!refused.message.includes(SECRET_PARAMETER));
      assert.ok(!Cause.pretty(Cause.fail(refused)).includes(SECRET_PARAMETER));
    }),
  );

  it.effect("a statement is inside the client's transaction around it and rolls back with it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const db = yield* Database;
      yield* makeTable;
      const ended = yield* Effect.result(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* db.insert(driverRow).values({ id: "rolled-back", tally: 9 });
            const inside = yield* db
              .select()
              .from(driverRow)
              .where(eq(driverRow.id, "rolled-back"));
            assert.deepEqual(inside, [{ id: "rolled-back", tally: 9 }]);
            return yield* Effect.fail(new Error(TABLE_ROLLBACK));
          }),
        ),
      );
      assert.ok(Result.isFailure(ended));
      const after = yield* sql`select id from drizzle_driver_row where id = 'rolled-back'`;
      assert.deepEqual(after, []);
    }),
  );

  it.effect("one Drizzle statement leaves its caller exactly where a raw one does", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const db = yield* Database;
      yield* makeTable;
      const raw = yield* leftStandingAfter(ALONE, () => sql`select 1 as one`);
      assert.notEqual(raw, undefined);
      const drizzled = yield* leftStandingAfter(ALONE, () => db.select().from(driverRow));
      assert.equal(drizzled, raw);
    }),
  );
});
