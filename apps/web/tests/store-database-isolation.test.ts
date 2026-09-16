import { Effect, ManagedRuntime } from "effect";
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

test("an unscoped delete through one build of the test SqlClient leaves a sibling build's rows standing", async () => {
  const deleter = ManagedRuntime.make(testSqlClient);
  const sibling = ManagedRuntime.make(testSqlClient);
  try {
    await sibling.runPromise(insertUser("user-kept"));
    await deleter.runPromise(insertUser("user-doomed"));
    expect(await deleter.runPromise(userIds)).toEqual(["user-doomed"]);

    await deleter.runPromise(deleteEveryUser);

    expect(await deleter.runPromise(userIds)).toEqual([]);
    expect(await sibling.runPromise(userIds)).toEqual(["user-kept"]);
  } finally {
    await Promise.all([deleter.dispose(), sibling.dispose()]);
  }
});
