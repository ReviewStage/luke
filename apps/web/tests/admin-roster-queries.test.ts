import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { USER_ROLE } from "../server/admin/admin-access";
import {
  readAdminDaySource,
  readAdminUserSource,
  readAdminUsersSource,
  writeAdminFavorite,
} from "../server/admin/admin-queries";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_WINDOW,
  type AdminMetricsScope,
} from "../server/admin/http";
import { HOSTED_DAILY_LIMIT } from "../server/hosted/quota";
import { testSqlClient } from "./support/sql-client";

/**
 * The roster, the day detail, the account page, and the star against a real
 * Postgres dialect. The search term is a token no other row carries, so the
 * roster's own total and rows read the seeded accounts alone on a shared
 * database, and one seeded name carries a literal `%` so the escaping the
 * `ilike` pattern does is pinned rather than assumed. Every instant sits in a
 * year no other suite writes into, which is what isolates the day read.
 *
 * Synthetic accounts, sessions, and usage days throughout.
 */

const NOW = Date.parse("2097-03-15T12:00:00.000Z");
const TODAY = "2097-03-15";
const YESTERDAY = "2097-03-14";
const SESSION_SEEN_AT = "2097-03-15T09:00:00.000Z";

it.layer(testSqlClient)("the dashboard's roster, day, account page, and star", (it) => {
  it.effect("what each read answers for one seeded roster", () =>
    Effect.gen(function* () {
      const token = `t${randomUUID().replace(/-/g, "")}`;
      const ids = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const open = (name: string, createdAt: string, role: string) =>
          Effect.gen(function* () {
            const id = `user-${randomUUID()}`;
            yield* sql`
            insert into "user" (id, name, email, created_at, role)
            values (${id}, ${name}, ${`${id}@luke.test`}, ${new Date(createdAt)}, ${role})
          `;
            return id;
          });
        const ada = yield* open(`Ada ${token}`, "2097-03-10T00:00:00.000Z", USER_ROLE.USER);
        const bo = yield* open(`Bo ${token}`, "2097-03-09T00:00:00.000Z", USER_ROLE.USER);
        const zed = yield* open(`Zed 100%${token}`, "2097-03-08T00:00:00.000Z", USER_ROLE.USER);
        const cy = yield* open(`Cy ${token}`, "2097-03-07T00:00:00.000Z", USER_ROLE.ADMIN);

        yield* sql`
        insert into account (id, account_id, provider_id, user_id, updated_at)
        values (${`account-${randomUUID()}`}, ${randomUUID()}, ${"google"}, ${ada}, ${new Date(NOW)})
      `;
        yield* sql`
        insert into session (id, expires_at, token, updated_at, user_id)
        values (
          ${`session-${randomUUID()}`},
          ${new Date("2097-04-01T00:00:00.000Z")},
          ${randomUUID()},
          ${new Date(SESSION_SEEN_AT)},
          ${ada}
        )
      `;
        const spend = (userId: string, day: string, calls: number) =>
          sql`insert into hosted_usage (user_id, day, calls) values (${userId}, ${day}, ${calls})`;
        yield* spend(ada, TODAY, 3);
        yield* spend(ada, YESTERDAY, HOSTED_DAILY_LIMIT + 2);
        yield* spend(bo, YESTERDAY, 1);
        yield* spend(cy, TODAY, 7);
        return { ada, bo, zed, cy };
      });

      const roster = (scope: AdminMetricsScope, search: string | undefined) =>
        readAdminUsersSource({
          now: NOW,
          scope,
          search,
          viewerId: ids.cy,
          windowDays: ADMIN_METRICS_WINDOW.MONTH,
        });

      const star = (userId: string, favorite: boolean) =>
        writeAdminFavorite({ adminId: ids.cy, userId, favorite });

      const searched = yield* roster(ADMIN_METRICS_SCOPE.NON_ADMINS, token);
      assert.equal(searched.total, 3);
      assert.deepEqual(
        searched.rows.map((row) => [
          row.id,
          row.activeDays,
          row.lastActiveDay,
          row.calls,
          row.admin,
        ]),
        [
          [ids.ada, 2, TODAY, HOSTED_DAILY_LIMIT + 5, false],
          [ids.bo, 1, YESTERDAY, 1, false],
          [ids.zed, 0, null, 0, false],
        ],
      );
      assert.deepEqual(
        searched.rows.map((row) => row.lastSeenAt),
        [Date.parse(SESSION_SEEN_AT), Date.parse(`${YESTERDAY}T00:00:00.000Z`), null],
      );
      assert.deepEqual(
        searched.rows.map((row) => row.favorite),
        [false, false, false],
      );

      const everyone = yield* roster(ADMIN_METRICS_SCOPE.ALL, token);
      assert.equal(everyone.total, 4);
      assert.deepEqual(
        everyone.rows.map((row) => [row.id, row.admin]),
        [
          [ids.ada, false],
          [ids.cy, true],
          [ids.bo, false],
          [ids.zed, false],
        ],
      );

      const literal = yield* roster(ADMIN_METRICS_SCOPE.NON_ADMINS, `100%${token}`);
      assert.equal(literal.total, 1);
      assert.deepEqual(
        literal.rows.map((row) => row.id),
        [ids.zed],
      );

      assert.equal(yield* star(ids.bo, true), true);
      assert.equal(yield* star(ids.bo, true), true);
      assert.equal(yield* star(`user-${randomUUID()}`, true), false);
      assert.deepEqual(
        (yield* roster(ADMIN_METRICS_SCOPE.NON_ADMINS, token)).rows.map((row) => row.favorite),
        [false, true, false],
      );
      assert.equal(yield* star(ids.bo, false), true);
      assert.deepEqual(
        (yield* roster(ADMIN_METRICS_SCOPE.NON_ADMINS, token)).rows.map((row) => row.favorite),
        [false, false, false],
      );

      const day = yield* readAdminDaySource({
        day: TODAY,
        scope: ADMIN_METRICS_SCOPE.NON_ADMINS,
      });
      assert.deepEqual(
        day.accounts.map((row) => [row.id, row.calls, row.admin]),
        [[ids.ada, 3, false]],
      );
      assert.deepEqual(day.totals, { accounts: 1, calls: 3 });

      const wholeDay = yield* readAdminDaySource({
        day: TODAY,
        scope: ADMIN_METRICS_SCOPE.ALL,
      });
      assert.deepEqual(
        wholeDay.accounts.map((row) => [row.id, row.calls, row.admin]),
        [
          [ids.cy, 7, true],
          [ids.ada, 3, false],
        ],
      );
      assert.deepEqual(wholeDay.totals, { accounts: 2, calls: 10 });

      const detail = yield* readAdminUserSource({
        userId: ids.ada,
        now: NOW,
        windowDays: ADMIN_METRICS_WINDOW.MONTH,
      });
      assert.deepEqual(detail?.account, {
        id: ids.ada,
        name: `Ada ${token}`,
        email: `${ids.ada}@luke.test`,
        image: null,
        admin: false,
        createdAt: Date.parse("2097-03-10T00:00:00.000Z"),
        signInMethods: ["google"],
      });
      assert.deepEqual(
        [...(detail?.usage.byDay ?? [])].toSorted(),
        [
          [TODAY, 3],
          [YESTERDAY, HOSTED_DAILY_LIMIT + 2],
        ].toSorted(),
      );
      assert.deepEqual(
        [...(detail?.usage.calendarByDay ?? [])].toSorted(),
        [
          [TODAY, 3],
          [YESTERDAY, HOSTED_DAILY_LIMIT + 2],
        ].toSorted(),
      );
      assert.deepEqual(detail?.usage.allTime, {
        activeDays: 2,
        firstActiveDay: YESTERDAY,
        lastActiveDay: TODAY,
        calls: HOSTED_DAILY_LIMIT + 5,
      });
      assert.equal(detail?.usage.quotaLimitedDaysWindow, 1);

      assert.equal(
        yield* readAdminUserSource({
          userId: `user-${randomUUID()}`,
          now: NOW,
          windowDays: ADMIN_METRICS_WINDOW.MONTH,
        }),
        undefined,
      );
    }),
  );
});
