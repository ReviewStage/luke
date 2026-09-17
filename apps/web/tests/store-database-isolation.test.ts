import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect, test } from "vitest";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { openHostedStoreTestDatabase, TEST_USER_NAME } from "./support/hosted-store-database";
import { testSqlClient } from "./support/sql-client";

/**
 * Two openings of the test database stand in for two `test:store` files: a
 * file opens its database through one of the two doors below, vitest runs the
 * files side by side, and what a statement in one file can reach is exactly
 * what one opening can reach. The deleter runs a `delete` scoped to nothing,
 * the mistake this suite has made four times; the sibling must still hold its
 * own row afterwards, which is what PGlite always gave a file locally and
 * what a shared Postgres never did.
 */

const deleteEveryUser = Effect.asVoid(db.delete(user));

const userIds = Effect.map(db.select({ id: user.id }).from(user).orderBy(user.id), (rows) =>
  rows.map((row) => row.id),
);

const insertUser = (id: string) =>
  Effect.asVoid(db.insert(user).values({ id, name: TEST_USER_NAME, email: `${id}@luke.test` }));

test("an unscoped delete through one store harness leaves a sibling harness's rows standing", async () => {
  const deleter = await openHostedStoreTestDatabase();
  const sibling = await openHostedStoreTestDatabase();
  try {
    const kept = await sibling.createUser();
    const doomed = await deleter.createUser();
    expect(await deleter.run(userIds)).toEqual([doomed]);

    await deleter.run(deleteEveryUser);

    expect(await deleter.run(userIds)).toEqual([]);
    expect(await sibling.run(userIds)).toEqual([kept]);
  } finally {
    await Promise.all([deleter.close(), sibling.close()]);
  }
});

it.effect(
  "an unscoped delete through one build of the test SqlClient leaves a sibling build's rows standing",
  () =>
    Effect.gen(function* () {
      // Two builds of the layer are two databases; each is built once here and closed with the test's scope.
      const deleter = yield* Layer.build(testSqlClient);
      const sibling = yield* Layer.build(testSqlClient);
      const through = <A, E>(
        context: typeof deleter,
        effect: Effect.Effect<A, E, SqlClient.SqlClient>,
      ) => Effect.provideContext(effect, context);

      yield* through(sibling, insertUser("user-kept"));
      yield* through(deleter, insertUser("user-doomed"));
      expect(yield* through(deleter, userIds)).toEqual(["user-doomed"]);

      yield* through(deleter, deleteEveryUser);

      expect(yield* through(deleter, userIds)).toEqual([]);
      expect(yield* through(sibling, userIds)).toEqual(["user-kept"]);
    }),
);
