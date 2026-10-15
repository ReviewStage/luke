import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { getTestDB } from "@luke/database/testing";
import { failureKind } from "@luke/runtime/effect";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { Cause, Effect, Result } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { isSqlError, type SqlError } from "effect/sql/SqlError";
import { expectTypeOf } from "vitest";

/**
 * Drizzle's own Effect driver over the `SqlClient` the test database stands
 * on, on whichever dialect this run was pointed at: Postgres through
 * `drizzle-orm/effect-postgres`, PGlite through `drizzle-orm/effect-pglite`.
 * The schema modules are tested elsewhere, so the table here is the test's
 * own: what is under test is that a statement lands on the same client and
 * the same transaction as a raw one, that its refusal still says what the
 * database said, that the refusal carries no bound parameter, and that it
 * leaves its caller in the async context a raw statement does.
 */

const driverRow = pgTable("drizzle_driver_row", {
  id: text("id").primaryKey(),
  tally: integer("tally").notNull(),
});

const TABLE_ROLLBACK = "The transaction is ended so the Drizzle insert in it is undone";

/** What a test binds where an account's secret would stand, so its absence can be read back. */
const SECRET_PARAMETER = "sk-live-never-in-a-failure";

/** The throwaway table the driver is exercised over, made by the client rather than the builder. */
const makeTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`create table if not exists drizzle_driver_row (id text primary key, tally integer not null)`;
});

/**
 * The async context a statement leaves its caller in, which is what the
 * test at the end of this file reads. eve keeps its session container in one
 * of these, so where a Drizzle statement leaves its caller is read against
 * where a raw statement on the same client leaves it.
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

/** One statement, built where it is yielded. */
type Statement = () => Effect.Effect<unknown, QueryError, DatabaseServices>;

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

/** A second insert of a row that already stands, refused by the primary key; the id binds the secret. */
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

/**
 * A query's failure as the compiler infers it, from the driver's own
 * declarations: a statement fails with the driver's error, and a transaction
 * around one with the client's `SqlError` beside it. Each is named, not `any`,
 * which is what a declaration importing a module path Effect 4.0.4 does not
 * have would collapse it to under `skipLibCheck`.
 */
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
        // A log line names the failure by what the database said, not by the wrapper's name.
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
            // The read sees a row no other connection could: the insert is in
            // this transaction rather than beside it.
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
      // Guard: the same as the contended run's below.
      assert.notEqual(raw, undefined);
      const drizzled = yield* leftStandingAfter(ALONE, () => db.select().from(driverRow));
      assert.equal(drizzled, raw);
    }),
  );
});
