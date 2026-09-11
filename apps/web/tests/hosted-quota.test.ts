import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { test } from "vitest";
import {
  HOSTED_DAILY_LIMIT,
  spendHostedMeter,
  spendIntroductionMeter,
  utcDayEnd,
  utcDayKey,
} from "../server/hosted/quota";
import { testSqlClient } from "./support/sql-client";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const openUser = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  yield* sql`
    insert into "user" (id, name, email)
    values (${userId}, ${"Test User"}, ${`${userId}@luke.test`})
  `;
  return userId;
});

test("a day key is the UTC date and resets at the following midnight", () => {
  assert.equal(utcDayKey(NOON_UTC), "2026-08-17");
  assert.equal(utcDayEnd("2026-08-17"), Date.parse("2026-08-18T00:00:00.000Z"));
});

test("the emergency ceiling stays high", () => {
  assert.equal(HOSTED_DAILY_LIMIT, 5_000);
});

it.layer(testSqlClient)("the quota meters over @effect/sql", (it) => {
  it.effect("a hosted spend increments the day's one counter", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const spend = yield* spendHostedMeter({ userId, now: NOON_UTC });
      assert.equal(spend.allowed, true);
      assert.deepEqual(spend.quota, {
        used: 1,
        limit: HOSTED_DAILY_LIMIT,
        resetsAt: utcDayEnd("2026-08-17"),
      });
    }),
  );

  it.effect("every hosted operation spends the same counter", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* spendHostedMeter({ userId, now: NOON_UTC });
      yield* spendHostedMeter({ userId, now: NOON_UTC });
      const third = yield* spendHostedMeter({ userId, now: NOON_UTC });
      assert.equal(third.quota.used, 3);
    }),
  );

  it.effect("the hosted ceiling allows its last use and refuses the next", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const userId = yield* openUser;
      const day = utcDayKey(NOON_UTC);
      yield* sql`
        insert into hosted_usage (user_id, day, calls) values (${userId}, ${day}, ${HOSTED_DAILY_LIMIT - 1})
      `;

      const atLimit = yield* spendHostedMeter({ userId, now: NOON_UTC });
      assert.equal(atLimit.allowed, true);
      assert.equal(atLimit.quota.used, HOSTED_DAILY_LIMIT);

      const overLimit = yield* spendHostedMeter({ userId, now: NOON_UTC });
      assert.equal(overLimit.allowed, false);
      assert.equal(overLimit.quota.used, HOSTED_DAILY_LIMIT + 1);
    }),
  );

  it.effect("an introduction spend moves the shared counter", () =>
    Effect.gen(function* () {
      const spend = yield* spendIntroductionMeter({ now: NOON_UTC + 1 });
      assert.equal(spend.allowed, true);
    }),
  );

  it.effect("a spent introduction ceiling refuses the next mint", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const day = NOON_UTC + DAY_MS;
      const dayKey = utcDayKey(day);
      yield* sql`
        insert into introduction_usage (caller, day, mints) values (${"global"}, ${dayKey}, ${HOSTED_DAILY_LIMIT})
      `;
      const overLimit = yield* spendIntroductionMeter({ now: day });
      assert.equal(overLimit.allowed, false);
    }),
  );
});
