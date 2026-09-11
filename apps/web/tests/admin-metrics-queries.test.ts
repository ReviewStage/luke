import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { USER_ROLE } from "../server/admin/admin-access";
import { readAdminMetricsSource } from "../server/admin/admin-queries";
import { ADMIN_METRICS_SCOPE, ADMIN_METRICS_WINDOW } from "../server/admin/http";
import { HOSTED_DAILY_LIMIT } from "../server/hosted/quota";
import { testSqlClient } from "./support/sql-client";

/**
 * The dashboard's aggregates against a real Postgres dialect. Every seeded
 * instant sits in a year no other suite writes into, so each windowed
 * aggregate here reads the seeded rows and nothing else however many accounts
 * the shared database already holds; `users.total`, which no window bounds,
 * is the one number that can only be stated as a floor.
 *
 * Synthetic accounts, provider links, and usage days throughout.
 */

const NOW = Date.parse("2099-03-15T12:00:00.000Z");
const TODAY = "2099-03-15";
const YESTERDAY = "2099-03-14";
/** Both usage days fall in the week Postgres truncates to this Monday. */
const ACTIVITY_WEEK = "2099-03-09";

const SIGN_IN_PROVIDER = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

interface SeededAccount {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const openUser = (name: string, createdAt: string, role: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const id = `user-${randomUUID()}`;
    const email = `${id}@luke.test`;
    yield* sql`
      insert into "user" (id, name, email, created_at, role)
      values (${id}, ${name}, ${email}, ${new Date(createdAt)}, ${role})
    `;
    return { id, name, email } satisfies SeededAccount;
  });

const linkSignIn = (userId: string, providerId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into account (id, account_id, provider_id, user_id, updated_at)
      values (${`account-${randomUUID()}`}, ${randomUUID()}, ${providerId}, ${userId}, ${new Date(NOW)})
    `;
  });

const spend = (userId: string, day: string, calls: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`insert into hosted_usage (user_id, day, calls) values (${userId}, ${day}, ${calls})`;
  });

const readSource = (scope: (typeof ADMIN_METRICS_SCOPE)[keyof typeof ADMIN_METRICS_SCOPE]) =>
  readAdminMetricsSource({
    now: NOW,
    integrations: [],
    scope,
    windowDays: ADMIN_METRICS_WINDOW.MONTH,
  });

const seed = Effect.gen(function* () {
  const ordinary = yield* openUser("Ada", "2099-03-10T00:00:00.000Z", USER_ROLE.USER);
  const quiet = yield* openUser("Bo", "2099-02-20T00:00:00.000Z", USER_ROLE.USER);
  const maintainer = yield* openUser("Cy", "2099-03-10T00:00:00.000Z", USER_ROLE.ADMIN);

  yield* linkSignIn(ordinary.id, SIGN_IN_PROVIDER.GOOGLE);
  yield* linkSignIn(ordinary.id, SIGN_IN_PROVIDER.GOOGLE);
  yield* linkSignIn(quiet.id, SIGN_IN_PROVIDER.GITHUB);
  yield* linkSignIn(maintainer.id, SIGN_IN_PROVIDER.GOOGLE);

  yield* spend(ordinary.id, TODAY, 3);
  yield* spend(ordinary.id, YESTERDAY, 2);
  yield* spend(quiet.id, YESTERDAY, 1);
  yield* spend(maintainer.id, TODAY, HOSTED_DAILY_LIMIT + 1);

  return { ordinary, quiet, maintainer };
});

it.layer(testSqlClient)("the dashboard's aggregates over @effect/sql", (it) => {
  it.effect("one window's aggregates, and what the two scopes keep of them", () =>
    Effect.gen(function* () {
      const { ordinary, quiet, maintainer } = yield* seed;
      const source = yield* readSource(ADMIN_METRICS_SCOPE.NON_ADMINS);

      assert.equal(source.systemHealth.database.reachable, true);
      assert.ok(source.systemHealth.database.latencyMs >= 0);
      assert.ok(source.users.total >= 2);
      // The sign-in chart counts every linked account in the table, which no
      // window bounds, so on a shared database the seed can state the floor
      // each bucket reaches and not the bucket itself — the same reason
      // `users.total` above is a floor. `tests/admin-metrics.test.ts` pins the
      // per-method fold itself, distinct pairs and all.
      assert.ok(source.users.signInMethods.google >= 1);
      assert.ok(source.users.signInMethods.github >= 1);
      assert.deepEqual(
        [...source.users.signupsByDay].toSorted(),
        [
          ["2099-02-20", 1],
          ["2099-03-10", 1],
        ].toSorted(),
      );

      assert.deepEqual(
        [...source.usage.byDay].toSorted(),
        [
          [YESTERDAY, 3],
          [TODAY, 3],
        ].toSorted(),
      );
      assert.equal(source.usage.activeUsersToday, 1);
      assert.equal(source.usage.activeUsersWindow, 2);
      assert.deepEqual(source.usage.topUsers, [
        {
          id: ordinary.id,
          name: ordinary.name,
          email: ordinary.email,
          image: null,
          admin: false,
          activeDays: 2,
          lastActiveDay: TODAY,
          calls: 5,
        },
        {
          id: quiet.id,
          name: quiet.name,
          email: quiet.email,
          image: null,
          admin: false,
          activeDays: 1,
          lastActiveDay: YESTERDAY,
          calls: 1,
        },
      ]);

      assert.deepEqual(
        [...source.retention.cohortSizes].toSorted(),
        [
          ["2099-02-16", 1],
          ["2099-03-09", 1],
        ].toSorted(),
      );
      assert.deepEqual(
        [...source.retention.activeByCohortWeek].map(([week, byWeek]) => [week, [...byWeek]]),
        [
          ["2099-02-16", [[ACTIVITY_WEEK, 1]]],
          ["2099-03-09", [[ACTIVITY_WEEK, 1]]],
        ].toSorted(),
      );

      assert.equal(source.reliability.quotaLimitedUserDaysToday, 0);
      assert.equal(source.reliability.quotaLimitedUserDaysWindow, 0);

      const everyone = yield* readSource(ADMIN_METRICS_SCOPE.ALL);
      assert.deepEqual(
        [...everyone.users.signupsByDay].toSorted(),
        [
          ["2099-02-20", 1],
          ["2099-03-10", 2],
        ].toSorted(),
      );
      assert.deepEqual(
        [...everyone.usage.byDay].toSorted(),
        [
          [YESTERDAY, 3],
          [TODAY, HOSTED_DAILY_LIMIT + 4],
        ].toSorted(),
      );
      assert.equal(everyone.usage.activeUsersToday, 2);
      assert.equal(everyone.usage.activeUsersWindow, 3);
      assert.deepEqual(
        everyone.usage.topUsers.map((row) => [row.id, row.admin, row.activeDays, row.calls]),
        [
          [ordinary.id, false, 2, 5],
          [maintainer.id, true, 1, HOSTED_DAILY_LIMIT + 1],
          [quiet.id, false, 1, 1],
        ],
      );
      assert.deepEqual(
        [...everyone.retention.cohortSizes].toSorted(),
        [
          ["2099-02-16", 1],
          ["2099-03-09", 2],
        ].toSorted(),
      );
      assert.equal(everyone.reliability.quotaLimitedUserDaysToday, 1);
      assert.equal(everyone.reliability.quotaLimitedUserDaysWindow, 1);
    }),
  );
});
